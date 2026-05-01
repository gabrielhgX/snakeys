/*
  Warnings:

  - A unique constraint covering the columns `[cpf]` on the table `User` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `cpf` to the `User` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
ALTER TYPE "TransactionType" ADD VALUE 'WITHDRAW';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "cpf" VARCHAR(11) NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "User_cpf_key" ON "User"("cpf");
