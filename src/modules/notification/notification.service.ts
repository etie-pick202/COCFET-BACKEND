import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, Repository } from 'typeorm';
import { paginer, ResultatPagine, triAutorise } from '../../common/pagination';
import { GenerationService } from '../generation/generation.service';
import { MailService } from '../mail/mail.service';
import { User } from '../user/entities/user.entity';
import {
  DiffuserNotificationDto,
  FiltreNotificationDto,
  MettreAJourPreferenceDto,
} from './dto/notification.dto';
import { Notification, TypeNotification } from './entities/notification.entity';
import { PreferenceNotification } from './entities/preference-notification.entity';
import type { CanalNotification } from './ports/canal-notification';
import { CANAL_NOTIFICATION } from './ports/canal-notification';

const TRIS_AUTORISES = ['createdAt', 'type'] as const;

/** Ce que les autres modules transmettent pour notifier quelqu'un. */
export interface DemandeNotification {
  destinataire: User | string;
  type: TypeNotification;
  titre: string;
  message: string;
  lien?: string | null;
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private readonly retentionJours: number;

  constructor(
    @InjectRepository(Notification)
    private readonly notifications: Repository<Notification>,
    @InjectRepository(PreferenceNotification)
    private readonly preferences: Repository<PreferenceNotification>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @Inject(CANAL_NOTIFICATION) private readonly canal: CanalNotification,
    private readonly generationService: GenerationService,
    private readonly mailService: MailService,
    config: ConfigService,
  ) {
    this.retentionJours = Number(
      config.get<string>('NOTIFICATIONS_RETENTION_JOURS', '180'),
    );
  }

  // ─────────────────────────────  Émission  ─────────────────────────────

  /**
   * Notifie une personne.
   *
   * **Ne lève jamais.** Une notification est un effet de bord : si l'envoi
   * échoue, la commande reste payée et le billet valide. Faire remonter
   * l'erreur annulerait l'action métier pour une raison qui ne la concerne
   * pas.
   */
  async notifier(demande: DemandeNotification): Promise<Notification | null> {
    try {
      const user = await this.resoudre(demande.destinataire);
      if (!user) {
        return null;
      }

      const notification = await this.notifications.save(
        this.notifications.create({
          user,
          type: demande.type,
          titre: demande.titre,
          message: demande.message,
          lien: demande.lien ?? null,
          isRead: false,
        }),
      );

      await this.diffuserSurLesCanaux(user, demande);

      return notification;
    } catch (erreur) {
      this.logger.error(
        `Échec de notification (${demande.type}) : ${(erreur as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Notifie un ensemble de destinataires en une passe.
   *
   * Les lignes sont insérées par lots plutôt qu'une par une : sur une
   * promotion entière, un aller-retour par utilisateur mettrait la base à
   * genoux et l'appel HTTP expirerait.
   */
  async diffuser(dto: DiffuserNotificationDto): Promise<number> {
    const destinataires = await this.cibler(dto);
    if (destinataires.length === 0) {
      return 0;
    }

    const LOT = 500;
    for (let i = 0; i < destinataires.length; i += LOT) {
      const tranche = destinataires.slice(i, i + LOT);
      await this.notifications.insert(
        tranche.map((user) => ({
          user,
          type: dto.type,
          titre: dto.titre,
          message: dto.message,
          lien: dto.lien ?? null,
          isRead: false,
        })),
      );
    }

    // Les canaux intrusifs partent ensuite, hors du chemin critique : une
    // diffusion à 300 personnes ne doit pas faire attendre la réponse HTTP de
    // l'administrateur, ni échouer si un destinataire est injoignable.
    void this.diffuserEnArrierePlan(destinataires, dto);

    this.logger.log(
      `Notification « ${dto.titre} » diffusée à ${destinataires.length} destinataire(s).`,
    );

    return destinataires.length;
  }

  // ─────────────────────────────  Lecture  ──────────────────────────────

  async lister(
    userId: string,
    filtre: FiltreNotificationDto,
  ): Promise<ResultatPagine<Notification>> {
    const tri = triAutorise(filtre.tri, TRIS_AUTORISES, 'createdAt');

    return paginer(
      await this.notifications.findAndCount({
        where: {
          user: { id: userId },
          ...(filtre.type ? { type: filtre.type } : {}),
          ...(filtre.nonLues ? { isRead: false } : {}),
        },
        order: { [tri]: filtre.ordre },
        skip: filtre.sauter,
        take: filtre.limite,
      }),
      filtre,
    );
  }

  compterNonLues(userId: string): Promise<number> {
    return this.notifications.count({
      where: { user: { id: userId }, isRead: false },
    });
  }

  // ─────────────────────────────  Mutation  ─────────────────────────────

  /**
   * Le filtrage sur `user_id` fait partie de la condition de mise à jour, et
   * non d'une lecture préalable : sans lui, connaître un identifiant suffirait
   * à marquer comme lue la notification de quelqu'un d'autre.
   */
  async marquerLu(userId: string, id: string): Promise<void> {
    const resultat = await this.notifications.update(
      { id, user: { id: userId } },
      { isRead: true },
    );

    if (resultat.affected === 0) {
      throw new NotFoundException("Cette notification n'existe pas.");
    }
  }

  async marquerToutLu(userId: string): Promise<number> {
    const resultat = await this.notifications.update(
      { user: { id: userId }, isRead: false },
      { isRead: true },
    );
    return resultat.affected ?? 0;
  }

  async supprimer(userId: string, id: string): Promise<void> {
    const resultat = await this.notifications.delete({
      id,
      user: { id: userId },
    });

    if (resultat.affected === 0) {
      throw new NotFoundException("Cette notification n'existe pas.");
    }
  }

  // ───────────────────────────  Préférences  ────────────────────────────

  /**
   * Réglages de l'utilisateur, complétés par les valeurs par défaut.
   *
   * Tous les types sont renvoyés, y compris ceux jamais réglés : l'interface a
   * besoin de la liste complète pour afficher ses interrupteurs, et l'absence
   * de ligne vaut « activé ».
   */
  async preferencesDe(
    userId: string,
  ): Promise<
    { type: TypeNotification; canalEmail: boolean; canalPush: boolean }[]
  > {
    const enregistrees = await this.preferences.find({
      where: { user: { id: userId } },
    });
    const parType = new Map(enregistrees.map((p) => [p.type, p]));

    return Object.values(TypeNotification).map((type) => ({
      type,
      canalEmail: parType.get(type)?.canalEmail ?? true,
      canalPush: parType.get(type)?.canalPush ?? true,
    }));
  }

  /**
   * Dit si un email de ce type peut partir vers cette personne.
   *
   * Ouvert aux autres modules : plusieurs envois — l'accueil d'un nouveau
   * compte, celui d'un membre du bureau — partent **hors** du circuit des
   * notifications, avec leur propre gabarit. Sans ce point d'interrogation, ils
   * ignoreraient purement et simplement le reglage de la personne, et le choix
   * qu'on lui offre n'en serait pas un.
   *
   * Vrai par defaut : l'absence de ligne vaut « active », comme partout
   * ailleurs. Un nouvel arrivant recoit donc tout, et coupe ensuite ce qu'il
   * ne veut plus.
   */
  async emailAutorise(
    userId: string,
    type: TypeNotification,
  ): Promise<boolean> {
    const preference = await this.preferences.findOne({
      where: { user: { id: userId }, type },
    });

    return preference?.canalEmail !== false;
  }

  async mettreAJourPreference(
    userId: string,
    dto: MettreAJourPreferenceDto,
  ): Promise<void> {
    const existante = await this.preferences.findOne({
      where: { user: { id: userId }, type: dto.type },
    });

    if (existante) {
      await this.preferences.update(existante.id, {
        ...(dto.canalEmail !== undefined ? { canalEmail: dto.canalEmail } : {}),
        ...(dto.canalPush !== undefined ? { canalPush: dto.canalPush } : {}),
      });
      return;
    }

    await this.preferences.insert({
      user: { id: userId } as User,
      type: dto.type,
      canalEmail: dto.canalEmail ?? true,
      canalPush: dto.canalPush ?? true,
    });
  }

  // ─────────────────────────────  Entretien  ────────────────────────────

  /**
   * Supprime les notifications lues devenues anciennes.
   *
   * Sans cela, la table croît indéfiniment : une plateforme multi-générations
   * accumulerait les notifications de promotions parties depuis des années,
   * pour un contenu que plus personne ne consulte.
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async purgerAnciennes(maintenant = new Date()): Promise<number> {
    const limite = new Date(
      maintenant.getTime() - this.retentionJours * 24 * 60 * 60 * 1000,
    );

    const resultat = await this.notifications.delete({
      isRead: true,
      createdAt: LessThan(limite),
    });

    const supprimees = resultat.affected ?? 0;
    if (supprimees > 0) {
      this.logger.log(`${supprimees} notification(s) ancienne(s) purgée(s).`);
    }
    return supprimees;
  }

  // ──────────────────────────────  Interne  ─────────────────────────────

  private async resoudre(destinataire: User | string): Promise<User | null> {
    return typeof destinataire === 'string'
      ? this.users.findOne({ where: { id: destinataire } })
      : destinataire;
  }

  private async cibler(dto: DiffuserNotificationDto): Promise<User[]> {
    const requete = this.users
      .createQueryBuilder('u')
      // Un compte non vérifié n'appartient à personne : lui écrire alimente
      // une boîte qui n'a jamais confirmé vouloir recevoir quoi que ce soit.
      .where('u.email_verifie_le IS NOT NULL')
      .andWhere('u.is_active = true');

    if (dto.roles?.length) {
      requete.andWhere('u.role IN (:...roles)', { roles: dto.roles });
    }
    if (dto.promotion !== undefined) {
      requete.andWhere('u.promotion = :promotion', {
        promotion: dto.promotion,
      });
    }
    if (dto.finissantsSeulement) {
      const generation = await this.generationService.trouverActive();
      if (!generation) {
        // Aucune génération active : « les finissants » ne désigne personne.
        // Diffuser à tout le monde serait une interprétation dangereuse.
        return [];
      }
      requete.andWhere('u.promotion = :annee', { annee: generation.annee });
    }

    return requete.getMany();
  }

  private async diffuserSurLesCanaux(
    user: User,
    demande: DemandeNotification,
  ): Promise<void> {
    const preference = await this.preferences.findOne({
      where: { user: { id: user.id }, type: demande.type },
    });

    if (preference?.canalPush !== false) {
      await this.canal.diffuser({
        destinataireId: user.id,
        type: demande.type,
        titre: demande.titre,
        corps: demande.message,
        lien: demande.lien ?? null,
      });
    }

    if (preference?.canalEmail !== false && user.emailVerifieLe) {
      await this.mailService.envoyerNotification(
        user.email,
        user.firstName,
        demande.titre,
        demande.message,
        demande.lien ?? null,
      );
    }
  }

  private async diffuserEnArrierePlan(
    destinataires: User[],
    dto: DiffuserNotificationDto,
  ): Promise<void> {
    const coupes = await this.preferences.find({
      where: {
        user: { id: In(destinataires.map((u) => u.id)) },
        type: dto.type,
      },
      relations: { user: true },
    });
    const parUser = new Map(coupes.map((p) => [p.user.id, p]));

    for (const user of destinataires) {
      const preference = parUser.get(user.id);
      try {
        if (preference?.canalPush !== false) {
          await this.canal.diffuser({
            destinataireId: user.id,
            type: dto.type,
            titre: dto.titre,
            corps: dto.message,
            lien: dto.lien ?? null,
          });
        }
        if (preference?.canalEmail !== false) {
          await this.mailService.envoyerNotification(
            user.email,
            user.firstName,
            dto.titre,
            dto.message,
            dto.lien ?? null,
          );
        }
      } catch (erreur) {
        // Un destinataire injoignable n'interrompt pas la diffusion aux
        // autres : c'est tout l'intérêt de traiter chacun séparément.
        this.logger.warn(
          `Diffusion échouée pour ${user.id} : ${(erreur as Error).message}`,
        );
      }
    }
  }
}
