import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FileModule } from '../file/file.module';
import { AuthModule } from '../auth/auth.module';
import { User } from './entities/user.entity';
import { PurgeComptesService } from './purge-comptes.service';
import { UserController } from './user.controller';
import { UserService } from './user.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([User]),
    forwardRef(() => AuthModule),
    FileModule,
  ],
  controllers: [UserController],
  providers: [UserService, PurgeComptesService],
  exports: [UserService, PurgeComptesService],
})
export class UserModule {}
