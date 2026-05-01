import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { DepositDto } from './dto/deposit.dto';
import { GetTransactionsQueryDto } from './dto/get-transactions.dto';
import { WithdrawDto } from './dto/withdraw.dto';
import { WalletService } from './wallet.service';

@Controller('wallet')
@UseGuards(JwtAuthGuard)
export class WalletController {
  constructor(private walletService: WalletService) {}

  @Get()
  getWallet(@Req() req: any) {
    return this.walletService.getWallet(req.user.id);
  }

  @Get('balance')
  getBalance(@Req() req: any) {
    return this.walletService.getBalance(req.user.id);
  }

  @Get('transactions')
  getTransactions(@Req() req: any, @Query() query: GetTransactionsQueryDto) {
    return this.walletService.getTransactions(req.user.id, query.limit, query.offset);
  }

  @Post('deposit')
  @HttpCode(HttpStatus.OK)
  initiateDeposit(@Req() req: any, @Body() dto: DepositDto) {
    return this.walletService.initiateDeposit(
      req.user.id,
      dto.amount,
      dto.idempotencyKey,
    );
  }

  @Post('withdraw')
  @HttpCode(HttpStatus.OK)
  requestWithdraw(@Req() req: any, @Body() dto: WithdrawDto) {
    return this.walletService.requestWithdraw(
      req.user.id,
      dto.amount,
      dto.cpf,
      dto.idempotencyKey,
    );
  }
}
