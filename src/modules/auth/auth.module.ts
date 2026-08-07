import { forwardRef, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule, JwtModuleOptions, JwtSignOptions } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GenerationModule } from '../generation/generation.module';
import { MailModule } from '../mail/mail.module';
import { UserModule } from '../user/user.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JetonAuth } from './entities/jeton-auth.entity';
import { JetonService } from './jeton.service';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    TypeOrmModule.forFeature([JetonAuth]),
    forwardRef(() => UserModule),
    GenerationModule,
    MailModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService): JwtModuleOptions => ({
        secret: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        signOptions: {
          expiresIn: config.get<string>('JWT_ACCESS_EXPIRES_IN', '15m'),
        } as JwtSignOptions,
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JetonService, JwtStrategy],
  exports: [AuthService, JetonService],
})
export class AuthModule {}
