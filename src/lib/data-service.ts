import { RpcProvider, Contract } from "starknet";
import { ResourcesIds } from "@frontboat/types";

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

export async function queryEternumAPI<T = unknown>(query: string): Promise<T> {
  try {
    const response = await fetch("https://api.cartridge.gg/x/eternum-game-mainnet-37/torii/sql", {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
      },
      body: query,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("API Error Response:", errorText);
      throw new Error(`API request failed with status ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    return data || [];
  } catch (error) {
    console.error("Error querying Eternum API:", error);
    throw error;
  }
}

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

function formatAmount(amountHex: string): string {
  const amount = BigInt(amountHex);
  // Most resources have 18 decimals, but we'll show as whole numbers for simplicity
  const divisor = 10n ** 18n;
  const wholeAmount = amount / divisor;
  const remainder = amount % divisor;
  
  if (remainder === 0n) {
    return wholeAmount.toString();
  } else {
    // Show with up to 6 decimal places, removing trailing zeros
    const decimal = remainder.toString().padStart(18, '0').slice(0, 6);
    return `${wholeAmount}.${decimal}`.replace(/\.?0+$/, '');
  }
}

export async function fetchAllResourceBalances(
  ownerAddress: string, 
  progressReporter?: ProgressReporter
): Promise<FetchResourcesResult> {
  progressReporter?.startStep('fetch-start', 'Starting Resource Fetch', `Fetching resources for owner: ${ownerAddress}`);
  const provider = new RpcProvider({ nodeUrl: 'https://api.cartridge.gg/x/starknet/mainnet' });

  // 1. Get user's structures (realms, villages) from indexer
  progressReporter?.startStep('fetch-structures', 'Querying User Structures', 'Getting realms and villages from indexer');
  const structuresQuery = `SELECT entity_id FROM "s1_eternum-Structure" WHERE owner = '${ownerAddress}' AND "base.category" IN (1, 5)`;
  const structureResults = await queryEternumAPI<{ entity_id: string }[]>(structuresQuery);
  
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

  // 2. Get all whitelisted resources from indexer
  progressReporter?.startStep('fetch-whitelist', 'Querying Whitelisted Resources', 'Getting resource whitelist configuration');
  const whitelistQuery = `SELECT resource_type, token FROM "s1_eternum-ResourceBridgeWhitelistConfig"`;
  const whitelistResults = await queryEternumAPI<{ resource_type: number; token: string }[]>(whitelistQuery);
  progressReporter?.completeStep('fetch-whitelist', `Found ${whitelistResults?.length || 0} whitelisted resources`);

  progressReporter?.startStep('build-calls', 'Building Balance Check Reference', 'Creating balance check calls for all entity-resource combinations');
  const callReference: Array<{
    entity_id: string;
    resource_contract_address: string;
    resource_name: string;
    resource_id: ResourcesIds;
  }> = [];

  for (const entityId of entityIds) {
    for (const resource of whitelistResults) {
      if (!resource.token || !resourceIdToInfo[resource.resource_type]) continue;

      callReference.push({
        entity_id: entityId,
        resource_contract_address: resource.token,
        resource_name: resourceIdToInfo[resource.resource_type].name,
        resource_id: resourceIdToInfo[resource.resource_type].id
      });
    }
  }

  if (callReference.length === 0) {
    progressReporter?.errorStep('build-calls', 'No balance checks could be created');
    return { 
      withdrawable: [], 
      all_balances: [], 
      summary: { total_entities: entityIds.length, total_resources_checked: 0, withdrawable_count: 0, whitelisted_count: whitelistResults.length } 
    };
  }

  progressReporter?.completeStep('build-calls', `Created ${callReference.length} balance checks (${whitelistResults.length} resources × ${entityIds.length} entities)`);

  progressReporter?.startStep('check-balances', 'Checking Resource Balances', 'Making individual balance calls to smart contracts');
  const allBalances: ResourceBalance[] = [];
  const withdrawableResources: WithdrawableResource[] = [];
  
  try {
    const testCalls = callReference; // Use all calls instead of sampling
    
    // Add substeps for progress tracking
    for (let i = 0; i < testCalls.length; i++) {
      const ref = testCalls[i];
      const subStepId = `balance-${i}`;
      progressReporter?.addSubStep('check-balances', subStepId, `${ref.resource_name} on entity ${ref.entity_id}`);
      progressReporter?.updateSubStep('check-balances', subStepId, { 
        status: 'in-progress', 
        current: i + 1, 
        total: testCalls.length 
      });
      
      try {
        // Create contract instance for this token
        const tokenContract = new Contract(
          [{ "name": "balanceOf", "type": "function", "inputs": [{"name": "account", "type": "felt"}], "outputs": [{"type": "Uint256"}], "state_mutability": "view" }],
          ref.resource_contract_address,
          provider
        );
        
        const balance = await tokenContract.balanceOf(ref.entity_id);
        
        // Handle different balance formats
        let balanceBigInt: bigint;
        if (typeof balance === 'bigint') {
          balanceBigInt = balance;
        } else if (balance && typeof balance === 'object' && 'low' in balance) {
          const low = balance.low ? BigInt(balance.low) : 0n;
          const high = balance.high ? BigInt(balance.high) : 0n;
          balanceBigInt = low + (high << 128n);
        } else {
          balanceBigInt = BigInt(balance || 0);
        }
        
        const amountHex = '0x' + balanceBigInt.toString(16);
        const isWithdrawable = balanceBigInt > 0n;
        
        allBalances.push({
          entity_id: ref.entity_id,
          resource_contract_address: ref.resource_contract_address,
          resource_name: ref.resource_name,
          resource_id: ref.resource_id,
          amount: amountHex,
          amount_formatted: formatAmount(amountHex),
          is_withdrawable: isWithdrawable,
          is_whitelisted: true
        });
        
        if (isWithdrawable) {
          progressReporter?.updateSubStep('check-balances', subStepId, { 
            status: 'completed', 
            detail: `Found balance: ${formatAmount(amountHex)}` 
          });
          withdrawableResources.push({
            entity_id: ref.entity_id,
            resource_contract_address: ref.resource_contract_address,
            resource_name: ref.resource_name,
            resource_id: ref.resource_id,
            amount: amountHex,
          });
        } else {
          progressReporter?.updateSubStep('check-balances', subStepId, { 
            status: 'completed', 
            detail: 'Zero balance' 
          });
        }
      } catch (callError) {
        progressReporter?.updateSubStep('check-balances', subStepId, { 
          status: 'error', 
          detail: `Error: ${callError instanceof Error ? callError.message : 'Unknown error'}` 
        });
        // Still add to allBalances with 0 amount
        allBalances.push({
          entity_id: ref.entity_id,
          resource_contract_address: ref.resource_contract_address,
          resource_name: ref.resource_name,
          resource_id: ref.resource_id,
          amount: '0x0',
          amount_formatted: '0',
          is_withdrawable: false,
          is_whitelisted: true
        });
      }
    }
    
    progressReporter?.completeStep('check-balances', `Found ${withdrawableResources.length} withdrawable resources out of ${allBalances.length} checked`);
    
  } catch(error) {
    progressReporter?.errorStep('check-balances', `Error during balance fetch: ${error instanceof Error ? error.message : 'Unknown error'}`);
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