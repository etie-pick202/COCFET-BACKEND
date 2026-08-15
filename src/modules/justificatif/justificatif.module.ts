import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BureauModule } from '../bureau/bureau.module';
import { FileModule } from '../file/file.module';
import { PaiementModule } from '../paiement/paiement.module';
import { JustificatifPaiement } from './entities/justificatif-paiement.entity';
import { JustificatifController } from './justificatif.controller';
import { JustificatifService } from './justificatif.service';
import { PurgeJustificatifsService } from './purge-justificatifs.service';

/**
 * `BureauModule` pour le garde des privilèges : c'est lui qui sait quels
 * postes accèdent aux finances, et donc qui peut trancher une preuve.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([JustificatifPaiement]),
    PaiementModule,
    FileModule,
    BureauModule,
  ],
  controllers: [JustificatifController],
  providers: [JustificatifService, PurgeJustificatifsService],
  exports: [JustificatifService],
})
export class JustificatifModule {}
