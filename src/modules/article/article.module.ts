import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FileModule } from '../file/file.module';
import { NotificationModule } from '../notification/notification.module';
import { ArticleController } from './article.controller';
import { ArticleService } from './article.service';
import { CommentaireService } from './commentaire.service';
import { Article } from './entities/article.entity';
import { CommentaireArticle } from './entities/commentaire-article.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Article, CommentaireArticle]),
    NotificationModule,
    FileModule,
  ],
  controllers: [ArticleController],
  providers: [ArticleService, CommentaireService],
  exports: [ArticleService],
})
export class ArticleModule {}
