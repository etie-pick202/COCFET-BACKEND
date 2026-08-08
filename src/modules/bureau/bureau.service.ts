import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Generation } from '../generation/entities/generation.entity';
import { User } from '../user/entities/user.entity';
import {
  AffecterMembreDto,
  BureauPublic,
  CreerPosteDto,
  exposerMembre,
  MembreExpose,
  MembrePublic,
  MettreAJourMembreDto,
  MettreAJourPosteDto,
} from './dto/bureau.dto';
import { MembreBureau } from './entities/membre-bureau.entity';
import { PosteBureau } from './entities/poste-bureau.entity';

@Injectable()
export class BureauService {
  constructor(
    @InjectRepository(PosteBureau)
    private readonly postes: Repository<PosteBureau>,
    @InjectRepository(MembreBureau)
    private readonly membres: Repository<MembreBureau>,
    @InjectRepository(Generation)
    private readonly generations: Repository<Generation>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
  ) {}

  // ───────────────────────────────  Postes  ─────────────────────────────

  listerPostes(): Promise<PosteBureau[]> {
    return this.postes.find({ order: { ordre: 'ASC', nom: 'ASC' } });
  }

  async creerPoste(dto: CreerPosteDto): Promise<PosteBureau> {
    if (await this.postes.findOne({ where: { nom: dto.nom } })) {
      throw new ConflictException(`Le poste « ${dto.nom} » existe déjà.`);
    }

    return this.postes.save(this.postes.create(dto));
  }

  async mettreAJourPoste(
    id: string,
    dto: MettreAJourPosteDto,
  ): Promise<PosteBureau> {
    const poste = await this.trouverPoste(id);

    if (dto.nom && dto.nom !== poste.nom) {
      if (await this.postes.findOne({ where: { nom: dto.nom } })) {
        throw new ConflictException(`Le poste « ${dto.nom} » existe déjà.`);
      }
    }

    await this.postes.update(id, dto);

    return this.trouverPoste(id);
  }

  /**
   * Supprime un poste du catalogue.
   *
   * Refusé dès qu'un mandat l'a attribué : effacer le poste effacerait avec
   * lui la trace de qui l'a occupé. Un poste qui n'a plus lieu d'être se
   * retire du prochain mandat en ne le pourvoyant pas.
   */
  async supprimerPoste(id: string): Promise<void> {
    await this.trouverPoste(id);

    const occupations = await this.membres.countBy({ poste: { id } });
    if (occupations > 0) {
      throw new ConflictException(
        `Ce poste a été occupé lors de ${occupations} mandat(s) : le supprimer effacerait cette histoire.`,
      );
    }

    await this.postes.delete(id);
  }

  // ───────────────────────────────  Membres  ────────────────────────────

  /**
   * Attribue un poste pour un mandat.
   *
   * Le titulaire doit être **un finissant de cette génération** : le COCFET
   * est le comité d'organisation de la cérémonie de fin d'étude, il est
   * composé de ceux qui la vivent. On compare la promotion à l'année du
   * mandat, et non `isFinissant` — celui-ci ne vaut que pour la génération
   * active, alors qu'on constitue le plus souvent le bureau **entrant**.
   */
  async affecter(
    generationId: string,
    dto: AffecterMembreDto,
  ): Promise<MembreExpose> {
    const generation = await this.trouverGeneration(generationId);

    if (generation.archivedAt) {
      throw new ConflictException(
        'Ce mandat est archivé : sa composition ne change plus.',
      );
    }

    const poste = await this.trouverPoste(dto.posteId);
    const user = await this.users.findOne({ where: { id: dto.userId } });

    if (!user) {
      throw new NotFoundException("Ce compte n'existe pas.");
    }
    if (user.promotion !== generation.annee) {
      throw new BadRequestException(
        `Le bureau ${generation.nom} est composé de finissants de la promotion ${generation.annee}. ` +
          'Ce compte relève d’une autre promotion.',
      );
    }
    if (!user.emailVerifieLe) {
      // Un compte non vérifié n'appartient à personne : lui confier un poste
      // reviendrait à confier le bureau à une adresse jamais confirmée.
      throw new BadRequestException(
        'Ce compte n’a pas confirmé son adresse : il ne peut pas siéger au bureau.',
      );
    }

    const occupe = await this.membres.findOne({
      where: { generation: { id: generationId }, poste: { id: dto.posteId } },
      relations: { user: true },
    });

    if (occupe) {
      throw new ConflictException(
        `Le poste « ${poste.nom} » est déjà occupé pour ce mandat. Retirez d’abord son titulaire.`,
      );
    }

    const enregistre = await this.membres.save(
      this.membres.create({
        generation,
        poste,
        user,
        presentation: dto.presentation ?? null,
      }),
    );

    return exposerMembre(enregistre);
  }

  async mettreAJourMembre(
    id: string,
    dto: MettreAJourMembreDto,
  ): Promise<MembreExpose> {
    await this.trouverMembre(id);
    await this.membres.update(id, dto);
    return exposerMembre(await this.trouverMembre(id));
  }

  async retirer(id: string): Promise<void> {
    const membre = await this.trouverMembre(id);

    if (membre.generation.archivedAt) {
      throw new ConflictException(
        'Ce mandat est archivé : sa composition ne change plus.',
      );
    }

    await this.membres.delete(id);
  }

  /** Usage interne : entités brutes, jamais renvoyées telles quelles. */
  listerMembres(generationId: string): Promise<MembreBureau[]> {
    return this.membres.find({
      where: { generation: { id: generationId } },
      relations: { poste: true, user: true },
      order: { poste: { ordre: 'ASC' } },
    });
  }

  /** Composition d'un mandat, telle que l'administration la consulte. */
  async composition(generationId: string): Promise<MembreExpose[]> {
    const membres = await this.listerMembres(generationId);

    return membres.map(exposerMembre);
  }

  /**
   * Composition publique du bureau en cours.
   *
   * Ni adresse email, ni identifiant de compte : la page est ouverte à tous,
   * et publier les adresses de la promotion les livrerait aux robots
   * collecteurs.
   */
  async bureauPublic(): Promise<BureauPublic | null> {
    const generation = await this.generations.findOne({
      where: { isActive: true },
    });

    if (!generation) {
      return null;
    }

    const membres = await this.listerMembres(generation.id);

    return {
      annee: generation.annee,
      nom: generation.nom,
      logo: generation.logo,
      couleurPrimaire: generation.couleurPrimaire,
      couleurSecondaire: generation.couleurSecondaire,
      membres: membres.map((m) => this.versMembrePublic(m)),
    };
  }

  // ─────────────────  Appelé par la bascule de génération  ──────────────

  /**
   * Vérifie qu'un mandat peut prendre ses fonctions.
   *
   * Sans ce contrôle, activer une génération basculerait la plateforme sur un
   * bureau vide : plus personne pour administrer, et une page « Le bureau »
   * qui n'affiche rien.
   */
  async verifierComposition(generationId: string): Promise<void> {
    const [postesCles, postesAdministrateurs] = await Promise.all([
      this.postes.findBy({ estCle: true }),
      this.postes.findBy({ accordeAdministration: true }),
    ]);

    const membres = await this.listerMembres(generationId);
    const pourvus = new Set(membres.map((m) => m.poste.id));

    const manquants = postesCles
      .filter((p) => !pourvus.has(p.id))
      .map((p) => p.nom);

    if (manquants.length > 0) {
      throw new BadRequestException(
        `Ce bureau est incomplet : ${manquants.join(', ')}. ` +
          'Désignez les titulaires avant d’activer le mandat.',
      );
    }

    if (
      postesAdministrateurs.length > 0 &&
      !postesAdministrateurs.some((p) => pourvus.has(p.id))
    ) {
      // Activer sans aucun administrateur entrant rendrait la plateforme
      // ingérable dès la bascule.
      throw new BadRequestException(
        'Aucun poste administrateur n’est pourvu : personne ne pourrait piloter la plateforme.',
      );
    }
  }

  /** Identifiants des titulaires de postes ouvrant l'administration. */
  async administrateursDe(generationId: string): Promise<string[]> {
    const membres = await this.membres.find({
      where: {
        generation: { id: generationId },
        poste: { accordeAdministration: true },
      },
      relations: { user: true, poste: true },
    });

    return membres.map((m) => m.user.id);
  }

  // ──────────────────────────────  Interne  ─────────────────────────────

  private versMembrePublic(membre: MembreBureau): MembrePublic {
    return {
      poste: membre.poste.nom,
      ordre: membre.poste.ordre,
      prenom: membre.user.firstName,
      nom: membre.user.lastName,
      avatar: membre.user.avatar,
      presentation: membre.presentation,
    };
  }

  private async trouverPoste(id: string): Promise<PosteBureau> {
    const poste = await this.postes.findOne({ where: { id } });

    if (!poste) {
      throw new NotFoundException("Ce poste n'existe pas.");
    }

    return poste;
  }

  private async trouverMembre(id: string): Promise<MembreBureau> {
    const membre = await this.membres.findOne({
      where: { id },
      relations: { poste: true, user: true, generation: true },
    });

    if (!membre) {
      throw new NotFoundException("Ce membre du bureau n'existe pas.");
    }

    return membre;
  }

  private async trouverGeneration(id: string): Promise<Generation> {
    const generation = await this.generations.findOne({ where: { id } });

    if (!generation) {
      throw new NotFoundException("Cette génération n'existe pas.");
    }

    return generation;
  }
}
