import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateListingDto } from './dto/create-listing.dto';
import { MarketplaceService } from './marketplace.service';

class ListingsQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit: number = 20;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset: number = 0;
}

@Controller('marketplace')
@UseGuards(JwtAuthGuard)
export class MarketplaceController {
  constructor(private marketplaceService: MarketplaceService) {}

  @Get()
  getListings(@Query() query: ListingsQueryDto) {
    return this.marketplaceService.getListings(query.limit, query.offset);
  }

  @Post('listings')
  createListing(@Req() req: any, @Body() dto: CreateListingDto) {
    return this.marketplaceService.createListing(req.user.id, dto.userItemId, dto.price);
  }

  @Delete('listings/:id')
  @HttpCode(HttpStatus.OK)
  cancelListing(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.marketplaceService.cancelListing(req.user.id, id);
  }

  @Post('listings/:id/buy')
  @HttpCode(HttpStatus.OK)
  buyListing(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.marketplaceService.buyListing(req.user.id, id);
  }
}
