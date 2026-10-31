import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../../../shared/auth/auth-user.js';
import { CurrentUser, Roles } from '../../../shared/auth/decorators.js';
import { ReviewsService } from '../application/reviews.service.js';
import {
  AdminListReviewsQuery,
  AdminReviewPage,
  ReviewView,
  SubmitReviewDto,
} from './review.dto.js';

@ApiTags('reviews')
@ApiBearerAuth()
@Controller()
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  /** "Rate & feedback" on a completed request */
  @Post('service-requests/:id/review')
  submit(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubmitReviewDto,
  ): Promise<ReviewView> {
    return this.reviews.submit(user.id, id, dto);
  }
}

@ApiTags('admin: reviews')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('admin/reviews')
export class AdminReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get()
  list(@Query() query: AdminListReviewsQuery): Promise<AdminReviewPage> {
    return this.reviews.listForAdmin({
      workerId: query.workerId,
      maxRating: query.maxRating,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });
  }
}
