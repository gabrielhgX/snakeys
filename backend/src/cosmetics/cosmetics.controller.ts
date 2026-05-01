import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { IsString, IsUUID } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CosmeticsService } from './cosmetics.service';

class EquipSkinDto {
  @IsString()
  @IsUUID('4')
  userItemId!: string;
}

/**
 * Read + equip endpoints for cosmetics. Listing the full inventory is
 * still served by `InventoryController` (with serial / float fields
 * exposed) — this controller is just for the equip pointer + the
 * "currently wearing" lookup that the lobby needs at boot.
 */
@Controller('cosmetics')
@UseGuards(JwtAuthGuard)
export class CosmeticsController {
  constructor(private cosmetics: CosmeticsService) {}

  @Get('equipped')
  getEquipped(@Req() req: any) {
    return this.cosmetics.getEquippedSkin(req.user.id);
  }

  @Post('equip')
  @HttpCode(HttpStatus.OK)
  equip(@Req() req: any, @Body() dto: EquipSkinDto) {
    return this.cosmetics.equipSkin(req.user.id, dto.userItemId);
  }

  @Delete('equip')
  @HttpCode(HttpStatus.OK)
  unequip(@Req() req: any) {
    return this.cosmetics.unequipSkin(req.user.id);
  }
}
