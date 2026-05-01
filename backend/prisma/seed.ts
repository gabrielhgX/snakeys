import {
  ItemType,
  PrismaClient,
  Rarity,
  RewardType,
} from '@prisma/client';

/**
 * Idempotent seed. Designed to be safe to run repeatedly on any
 * environment — every write is an upsert keyed on a stable slug / level.
 *
 * Covers:
 *   1. The "snakeys" entry in the Game catalog.
 *   2. A starter pool of SKIN items of every rarity so the Battle Pass
 *      skin-reward draws always have at least one candidate to mint.
 *   3. All 100 rows of the Battle Pass season. Mix is tuned so every
 *      ~5 levels is a skin of escalating rarity, with cash + XP fillers
 *      in between.
 *
 * Run: `npx prisma db seed` (after `prisma migrate` creates the tables).
 */
const prisma = new PrismaClient();

async function main() {
  console.log('⇢ Seeding Game catalog…');
  await prisma.game.upsert({
    where: { id: 'snakeys' },
    create: {
      id: 'snakeys',
      name: 'Snakeys',
      description: 'Arena-scale multiplayer snake with real money stakes.',
      isActive: true,
    },
    update: {
      name: 'Snakeys',
      description: 'Arena-scale multiplayer snake with real money stakes.',
      isActive: true,
    },
  });

  // ── Starter skin catalog ──────────────────────────────────────────────
  // Stable ids are use so re-runs don't create duplicate rows. Each
  // rarity tier has at least 2 items so the random-from-pool draw
  // doesn't always pick the same one.
  console.log('⇢ Seeding Item (SKIN) catalog…');
  const skins: Array<{
    id: string;
    name: string;
    rarity: Rarity;
    description: string;
  }> = [
    {
      id: 'skin-emerald',
      name: 'Serpente Esmeralda',
      rarity: Rarity.COMMON,
      description: 'Escamas verdes de padrão uniforme.',
    },
    {
      id: 'skin-ruby',
      name: 'Serpente Rubi',
      rarity: Rarity.COMMON,
      description: 'Pele vermelha com brilho fosco.',
    },
    {
      id: 'skin-azure',
      name: 'Serpente Azure',
      rarity: Rarity.RARE,
      description: 'Tons azul-cobalto com listras sutis.',
    },
    {
      id: 'skin-golden',
      name: 'Serpente Dourada',
      rarity: Rarity.RARE,
      description: 'Acabamento metálico em ouro escovado.',
    },
    {
      id: 'skin-obsidian',
      name: 'Serpente Obsidiana',
      rarity: Rarity.EPIC,
      description: 'Preto vítreo com reflexos roxos.',
    },
    {
      id: 'skin-celestial',
      name: 'Serpente Celestial',
      rarity: Rarity.EPIC,
      description: 'Padrão de constelações animadas.',
    },
    {
      id: 'skin-void',
      name: 'Serpente do Vazio',
      rarity: Rarity.LEGENDARY,
      description: 'Efeito de buraco negro no corpo.',
    },
    {
      id: 'skin-phoenix',
      name: 'Serpente Phoenix',
      rarity: Rarity.LEGENDARY,
      description: 'Chamas em gradiente dourado e carmesim.',
    },
  ];

  for (const skin of skins) {
    await prisma.item.upsert({
      where: { id: skin.id },
      create: {
        id: skin.id,
        name: skin.name,
        description: skin.description,
        type: ItemType.SKIN,
        rarity: skin.rarity,
        gameId: 'snakeys',
      },
      update: {
        name: skin.name,
        description: skin.description,
        rarity: skin.rarity,
        gameId: 'snakeys',
      },
    });
  }

  // ── Battle Pass rewards (levels 1..100) ───────────────────────────────
  console.log('⇢ Seeding BattlePassReward rows…');
  for (let level = 1; level <= 100; level++) {
    const def = rewardForLevel(level);
    await prisma.battlePassReward.upsert({
      where: { level },
      create: {
        level,
        rewardType: def.rewardType,
        balanceAmount: def.balanceAmount ?? null,
        xpAmount: def.xpAmount ?? null,
        skinGameId: def.skinGameId ?? null,
        skinRarity: def.skinRarity ?? null,
        description: def.description,
      },
      update: {
        rewardType: def.rewardType,
        balanceAmount: def.balanceAmount ?? null,
        xpAmount: def.xpAmount ?? null,
        skinGameId: def.skinGameId ?? null,
        skinRarity: def.skinRarity ?? null,
        description: def.description,
      },
    });
  }

  console.log('✓ Seed complete');
}

/**
 * Reward curve for level N. The cadence is:
 *   • 25, 50, 75, 100 → LEGENDARY skin (marquee levels)
 *   • 10, 20, 30, 40, 60, 70, 80, 90 → EPIC skin
 *   • other multiples of 5 → RARE skin
 *   • levels ending in 3 or 7 → COMMON skin
 *   • remaining odd levels → BALANCE (R$ prize)
 *   • remaining even levels → XP_BONUS
 *
 * Cash and XP values scale with level so late-game rewards feel better
 * than the early grind ones.
 */
function rewardForLevel(level: number): {
  rewardType: RewardType;
  balanceAmount?: number;
  xpAmount?: number;
  skinGameId?: string;
  skinRarity?: Rarity;
  description: string;
} {
  const isMilestone25 = level % 25 === 0;
  const isMultipleOf10 = level % 10 === 0;
  const isMultipleOf5 = level % 5 === 0;
  const lastDigit = level % 10;
  const endsIn3Or7 = lastDigit === 3 || lastDigit === 7;

  if (isMilestone25) {
    return {
      rewardType: RewardType.SKIN,
      skinGameId: 'snakeys',
      skinRarity: Rarity.LEGENDARY,
      description: `Skin LENDÁRIA aleatória — marco nível ${level}`,
    };
  }
  if (isMultipleOf10) {
    return {
      rewardType: RewardType.SKIN,
      skinGameId: 'snakeys',
      skinRarity: Rarity.EPIC,
      description: `Skin ÉPICA aleatória — nível ${level}`,
    };
  }
  if (isMultipleOf5) {
    return {
      rewardType: RewardType.SKIN,
      skinGameId: 'snakeys',
      skinRarity: Rarity.RARE,
      description: `Skin RARA aleatória — nível ${level}`,
    };
  }
  if (endsIn3Or7) {
    return {
      rewardType: RewardType.SKIN,
      skinGameId: 'snakeys',
      skinRarity: Rarity.COMMON,
      description: `Skin COMUM aleatória — nível ${level}`,
    };
  }
  if (level % 2 === 1) {
    // Odd filler → cash. 5 → 50 R$ curve (5 reais at lvl 1, 50 at lvl 99).
    const amount = 5 + Math.floor((level / 100) * 45);
    return {
      rewardType: RewardType.BALANCE,
      balanceAmount: amount,
      description: `R$ ${amount} em saldo`,
    };
  }
  // Even filler → xp bonus. 200 → 2000 XP curve.
  const xpAmount = 200 + Math.floor((level / 100) * 1800);
  return {
    rewardType: RewardType.XP_BONUS,
    xpAmount,
    description: `${xpAmount} XP de bônus`,
  };
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
