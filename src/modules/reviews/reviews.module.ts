import { Module } from '@nestjs/common';
import { AuthAccountsModule } from '../auth/auth.module.js';
import { ServiceRequestsModule } from '../service-requests/service-requests.module.js';
import { ReviewsService } from './application/reviews.service.js';
import {
  AdminReviewsController,
  ReviewsController,
} from './presentation/reviews.controller.js';

@Module({
  imports: [ServiceRequestsModule, AuthAccountsModule],
  controllers: [ReviewsController, AdminReviewsController],
  providers: [ReviewsService],
})
export class ReviewsModule {}
