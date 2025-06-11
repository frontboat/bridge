import { ResourcesIds } from "@frontboat/types";
import { buildApiUrl, fetchWithErrorHandling } from "./utils";
import { populateResourceContracts } from "./contract-verifier";

const API_BASE_URL = "https://api.cartridge.gg/x/eternum-game-mainnet-37/torii/sql";

export interface WithdrawableResource {
  entity_id: string; // realm_id
  resource_contract_address: string; // token
  amount: string; // hex_amount
  resource_name: string;
  resource_id: ResourcesIds;
}

export interface ResourceBalance {
  entity_id: string;
  resource_contract_address: string;
  resource_name: string;
  resource_id: ResourcesIds;
  amount: string; // hex_amount
  amount_formatted: string; // human readable
  is_withdrawable: boolean;
  is_whitelisted: boolean;
  rarity?: string;
  ticker?: string;
}

export interface FetchResourcesResult {
  withdrawable: WithdrawableResource[];
  all_balances: ResourceBalance[];
  summary: {
    total_entities: number;
    total_resources_checked: number;
    withdrawable_count: number;
    whitelisted_count: number;
  };
}

export interface ProgressReporter {
  startStep: (stepId: string, name: string, detail?: string) => void;
  updateStep: (stepId: string, detail: string) => void;
  addSubStep: (stepId: string, subStepId: string, name: string) => void;
  updateSubStep: (stepId: string, subStepId: string, updates: { 
    status?: 'pending' | 'in-progress' | 'completed' | 'error'; 
    detail?: string; 
    current?: number; 
    total?: number; 
  }) => void;
  completeStep: (stepId: string, detail?: string) => void;
  errorStep: (stepId: string, error: string) => void;
}

function formatAmount(amountHex: string): string {
  const amount = BigInt(amountHex);
  if (amount === 0n) {
    return '0';
  }

  // Resource balances use 9 decimals of precision (1e9), same as resource-checker
  const divisor = 1_000_000_000n; // 1e9
  const wholeAmount = amount / divisor;
  const remainder = amount % divisor;

  if (remainder === 0n) {
    return wholeAmount.toString();
  }
  
  const decimalPart = remainder.toString().padStart(9, '0');
  const trimmedDecimalPart = decimalPart.replace(/0+$/, '');

  // Handle cases where the trimmed part is empty (e.g., "1.000" becomes "1")
  if (trimmedDecimalPart.length === 0) {
    return wholeAmount.toString();
  }

  return `${wholeAmount}.${trimmedDecimalPart}`;
}

export async function fetchAllResourceBalances(
  ownerAddress: string, 
  progressReporter?: ProgressReporter
): Promise<FetchResourcesResult> {
  progressReporter?.startStep('fetch-start', 'Starting Resource Fetch', `Fetching resources for owner: ${ownerAddress}`);

  // 1. Get user's structures (realms, villages) from indexer
  progressReporter?.startStep('fetch-structures', 'Querying User Structures', 'Getting realms and villages from indexer');
  
  const structuresQuery = `SELECT entity_id FROM "s1_eternum-Structure" WHERE owner = '${ownerAddress}' AND "base.category" IN (1, 5)`;
  const structuresUrl = buildApiUrl(API_BASE_URL, structuresQuery);
  const structureResults = await fetchWithErrorHandling<{ entity_id: string }>(structuresUrl, 'Failed to fetch user structures');
  
  if (!structureResults || structureResults.length === 0) {
    progressReporter?.errorStep('fetch-structures', 'No structures found for this address');
    return { 
      withdrawable: [], 
      all_balances: [], 
      summary: { total_entities: 0, total_resources_checked: 0, withdrawable_count: 0, whitelisted_count: 0 } 
    };
  }
  
  const entityIds = structureResults.map(s => s.entity_id);
  progressReporter?.completeStep('fetch-structures', `Found ${structureResults.length} structures: ${entityIds.join(', ')}`);

  // 2. Get all whitelisted resources from indexer (still need this for contract addresses)
  progressReporter?.startStep('fetch-whitelist', 'Querying Whitelisted Resources', 'Getting resource whitelist configuration');
  const whitelistQuery = `SELECT resource_type, token FROM "s1_eternum-ResourceBridgeWhitelistConfig"`;
  const whitelistUrl = buildApiUrl(API_BASE_URL, whitelistQuery);
  const whitelistResults = await fetchWithErrorHandling<{ resource_type: number; token: string }>(whitelistUrl, 'Failed to fetch whitelist');
  progressReporter?.completeStep('fetch-whitelist', `Found ${whitelistResults?.length || 0} whitelisted resources`);

  // Populate resource contracts for verification
  const resourceInfoMapping = Object.fromEntries(
    Object.entries(resourceIdToInfo).map(([key, value]) => [parseInt(key, 10), { name: value.name }])
  );
  populateResourceContracts(whitelistResults, resourceInfoMapping);

  const resourceTypeToTokenMap = new Map<number, string>();
  for (const resource of whitelistResults) {
    if (resource.token) {
      resourceTypeToTokenMap.set(resource.resource_type, resource.token);
    }
  }

  const resourceNameMap = new Map<string, { id: ResourcesIds; number: number }>();
  for (const [key, value] of Object.entries(resourceIdToInfo)) {
    resourceNameMap.set(value.name, { id: value.id, number: parseInt(key, 10) });
  }

  progressReporter?.startStep('fetch-balances', 'Querying All Resource Balances', 'Building and executing a unified query for all resources');
  
  const allBalances: ResourceBalance[] = [];
  const withdrawableResources: WithdrawableResource[] = [];
  
  try {
    if (entityIds.length === 0) {
      throw new Error("No entity IDs found to query for balances.");
    }
    
    const selectStatements = Object.values(resourceIdToInfo).map(resource => {
      const balanceColumn = `"${resource.name}_BALANCE"`;
      return `SELECT entity_id, '${resource.name}' AS resource_type, ${balanceColumn} AS balance FROM "s1_eternum-Resource" WHERE entity_id IN (${entityIds.join(',')}) AND ${balanceColumn} IS NOT NULL AND ${balanceColumn} > 0`;
    });

    const balanceQuery = selectStatements.join('\nUNION ALL\n');
    const balanceUrl = buildApiUrl(API_BASE_URL, balanceQuery);

    type BalanceResult = { entity_id: string; resource_type: string; balance: string; };
    const balanceResults = await fetchWithErrorHandling<BalanceResult>(balanceUrl, 'Failed to fetch resource balances');

    progressReporter?.updateStep('fetch-balances', `Processing ${balanceResults.length} balance entries found`);

    for (const balanceResult of balanceResults) {
      const resourceInfo = resourceNameMap.get(balanceResult.resource_type);
      if (!resourceInfo) {
        continue;
      }

      const tokenAddress = resourceTypeToTokenMap.get(resourceInfo.number);
      if (!tokenAddress) {
        continue; // Not a whitelisted resource for bridging
      }

      const balanceBigInt = BigInt(balanceResult.balance);
      const isWithdrawable = balanceBigInt > 0n;

      const balance: ResourceBalance = {
        entity_id: balanceResult.entity_id,
        resource_contract_address: tokenAddress,
        resource_name: balanceResult.resource_type,
        resource_id: resourceInfo.id,
        amount: balanceResult.balance,
        amount_formatted: formatAmount(balanceResult.balance),
        is_withdrawable: isWithdrawable,
        is_whitelisted: true,
      };
      allBalances.push(balance);

      if (isWithdrawable) {
        withdrawableResources.push({
          entity_id: balance.entity_id,
          resource_contract_address: balance.resource_contract_address,
          amount: balance.amount,
          resource_name: balance.resource_name,
          resource_id: balance.resource_id,
        });
      }
    }
    progressReporter?.completeStep('fetch-balances', `Found ${withdrawableResources.length} types of withdrawable resources across all entities.`);

  } catch(error) {
    progressReporter?.errorStep('fetch-balances', `Error during balance fetch: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  return {
    withdrawable: withdrawableResources,
    all_balances: allBalances,
    summary: {
      total_entities: entityIds.length,
      total_resources_checked: allBalances.length,
      withdrawable_count: withdrawableResources.length,
      whitelisted_count: whitelistResults.length
    }
  };
}

export async function fetchWithdrawableResources(ownerAddress: string, progressReporter?: ProgressReporter): Promise<WithdrawableResource[]> {
  const result = await fetchAllResourceBalances(ownerAddress, progressReporter);
  return result.withdrawable;
}

// TODO: This should be defined in a more central place, maybe alongside the enums
const resourceIdToInfo: { [key: number]: { name: string; id: ResourcesIds } } = {
  1: { name: "STONE", id: ResourcesIds.Stone },
  2: { name: "COAL", id: ResourcesIds.Coal }, 
  3: { name: "WOOD", id: ResourcesIds.Wood },
  4: { name: "COPPER", id: ResourcesIds.Copper },
  5: { name: "IRONWOOD", id: ResourcesIds.Ironwood },
  6: { name: "OBSIDIAN", id: ResourcesIds.Obsidian },
  7: { name: "GOLD", id: ResourcesIds.Gold },
  8: { name: "SILVER", id: ResourcesIds.Silver },
  9: { name: "MITHRAL", id: ResourcesIds.Mithral },
  10: { name: "ALCHEMICAL_SILVER", id: ResourcesIds.AlchemicalSilver },
  11: { name: "COLD_IRON", id: ResourcesIds.ColdIron },
  12: { name: "DEEP_CRYSTAL", id: ResourcesIds.DeepCrystal },
  13: { name: "RUBY", id: ResourcesIds.Ruby },
  14: { name: "DIAMONDS", id: ResourcesIds.Diamonds },
  15: { name: "HARTWOOD", id: ResourcesIds.Hartwood },
  16: { name: "IGNIUM", id: ResourcesIds.Ignium },
  17: { name: "TWILIGHT_QUARTZ", id: ResourcesIds.TwilightQuartz },
  18: { name: "TRUE_ICE", id: ResourcesIds.TrueIce },
  19: { name: "ADAMANTINE", id: ResourcesIds.Adamantine },
  20: { name: "SAPPHIRE", id: ResourcesIds.Sapphire },
  21: { name: "ETHEREAL_SILICA", id: ResourcesIds.EtherealSilica },
  22: { name: "DRAGONHIDE", id: ResourcesIds.Dragonhide },
  23: { name: "LABOR", id: ResourcesIds.Labor },
  24: { name: "EARTHEN_SHARD", id: ResourcesIds.AncientFragment }, // Using AncientFragment for EARTHEN_SHARD
  25: { name: "DONKEY", id: ResourcesIds.Donkey },
  26: { name: "KNIGHT_T1", id: ResourcesIds.Knight },
  27: { name: "KNIGHT_T2", id: ResourcesIds.KnightT2 },
  28: { name: "KNIGHT_T3", id: ResourcesIds.KnightT3 },
  29: { name: "CROSSBOWMAN_T1", id: ResourcesIds.Crossbowman },
  30: { name: "CROSSBOWMAN_T2", id: ResourcesIds.CrossbowmanT2 },
  31: { name: "CROSSBOWMAN_T3", id: ResourcesIds.CrossbowmanT3 },
  32: { name: "PALADIN_T1", id: ResourcesIds.Paladin },
  33: { name: "PALADIN_T2", id: ResourcesIds.PaladinT2 },
  34: { name: "PALADIN_T3", id: ResourcesIds.PaladinT3 },
  35: { name: "WHEAT", id: ResourcesIds.Wheat },
  36: { name: "FISH", id: ResourcesIds.Fish },
  37: { name: "LORDS", id: ResourcesIds.Lords }
};