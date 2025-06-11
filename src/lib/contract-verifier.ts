import { Contract, type ProviderInterface } from "starknet"

// Resource contract addresses - populated from whitelist data
let RESOURCE_CONTRACTS: Record<string, string> = {}

/**
 * Populate resource contract addresses from whitelist data
 * Call this after fetching whitelist in your data-service
 */
export function populateResourceContracts(whitelistData: Array<{ resource_type: number; token: string }>, resourceMapping: Record<number, { name: string }>) {
  RESOURCE_CONTRACTS = {}
  for (const item of whitelistData) {
    const resourceInfo = resourceMapping[item.resource_type]
    if (resourceInfo && item.token) {
      RESOURCE_CONTRACTS[resourceInfo.name] = item.token
    }
  }
  console.log('Populated resource contracts:', Object.keys(RESOURCE_CONTRACTS).length, 'contracts')
  console.log('Available resource contracts:', Object.keys(RESOURCE_CONTRACTS))
}

export function getResourceContracts(): Record<string, string> {
  return { ...RESOURCE_CONTRACTS }
}

/**
 * Apply contract balance corrections to withdrawable resources
 */
export function applyCorrectedBalances(
  resources: Array<{ entity_id: string; resource_name: string; amount: string }>,
  verificationResults: ContractBalanceResult[]
): Array<{ entity_id: string; resource_name: string; amount: string; was_corrected: boolean; original_amount?: string }> {
  const correctionMap = new Map<string, ContractBalanceResult>()
  
  // Build a lookup map for corrections
  for (const result of verificationResults) {
    const key = `${result.entity_id}-${result.resource_name}`
    correctionMap.set(key, result)
  }
  
  // Apply corrections to resources
  return resources.map(resource => {
    const key = `${resource.entity_id}-${resource.resource_name}`
    const correction = correctionMap.get(key)
    
    if (correction && !correction.matches && correction.corrected_amount) {
      // Only include if corrected amount is > 0
      const correctedAmount = correction.corrected_amount
      const hasBalance = BigInt(correctedAmount) > 0n
      
      if (hasBalance) {
        return {
          ...resource,
          amount: correctedAmount,
          was_corrected: true,
          original_amount: resource.amount,
        }
      } else {
        // Return null for resources with 0 balance - they'll be filtered out
        return null
      }
    }
    
    return {
      ...resource,
      was_corrected: false,
    }
  }).filter(Boolean) as Array<{ entity_id: string; resource_name: string; amount: string; was_corrected: boolean; original_amount?: string }>
}

export interface ContractBalanceResult {
  entity_id: string
  resource_name: string
  indexer_balance: string
  contract_balance: string
  matches: boolean
  corrected_amount?: string // The amount we should actually use
}

/**
 * Verify a resource balance directly against the contract
 * This is slower but more accurate than indexer data
 */
export async function verifyResourceBalance(
  provider: ProviderInterface,
  entityId: string,
  resourceName: string,
  expectedBalance: string
): Promise<ContractBalanceResult> {
  try {
    const contractAddress = RESOURCE_CONTRACTS[resourceName]
    if (!contractAddress) {
      console.warn(`No contract address found for resource: ${resourceName}`)
      // Return as not matching if we can't verify
      return {
        entity_id: entityId,
        resource_name: resourceName,
        indexer_balance: expectedBalance,
        contract_balance: "unknown",
        matches: false,
        corrected_amount: "0", // If we can't verify, assume 0 for safety
      }
    }

    console.log(`Verifying ${resourceName} for entity ${entityId}: contract ${contractAddress}`)

    // Create contract instance
    const contract = new Contract(
      [
        {
          name: "balance_of", 
          type: "function",
          inputs: [{ name: "account", type: "ContractAddress" }],
          outputs: [{ name: "balance", type: "u256" }],
          state_mutability: "view"
        },
      ],
      contractAddress,
      provider
    )

    // Query the actual balance from contract using call (read-only)
    const result = await contract.call("balance_of", [entityId])
    const contractBalance = Array.isArray(result) && result.length > 0 ? result[0].toString() : "0"

    console.log(`Verification result for ${resourceName} entity ${entityId}: indexer=${expectedBalance}, contract=${contractBalance}`)

    const matches = contractBalance === expectedBalance
    return {
      entity_id: entityId,
      resource_name: resourceName,
      indexer_balance: expectedBalance,
      contract_balance: contractBalance,
      matches,
      corrected_amount: matches ? expectedBalance : contractBalance,
    }
  } catch (error) {
    console.error(`Error verifying balance for ${resourceName} entity ${entityId}:`, error)
    // Return as mismatch if verification fails
          return {
        entity_id: entityId,
        resource_name: resourceName,
        indexer_balance: expectedBalance,
        contract_balance: "error",
        matches: false,
        corrected_amount: "0", // If verification fails, assume 0 for safety
      }
  }
}

/**
 * Verify multiple resource balances in parallel
 */
export async function verifyMultipleBalances(
  provider: ProviderInterface,
  resources: Array<{ entity_id: string; resource_name: string; amount: string }>
): Promise<ContractBalanceResult[]> {
  const verificationPromises = resources.map((resource) =>
    verifyResourceBalance(provider, resource.entity_id, resource.resource_name, resource.amount)
  )

  return Promise.all(verificationPromises)
}

/**
 * Check if indexer data seems stale by comparing a sample of balances
 */
export async function checkDataFreshness(
  provider: ProviderInterface,
  resources: Array<{ entity_id: string; resource_name: string; amount: string }>,
  sampleSize: number = 5
): Promise<{
  total_checked: number
  mismatches: number
  mismatch_percentage: number
  seems_stale: boolean
}> {
  // Take a random sample to check
  const sample = resources.slice(0, Math.min(sampleSize, resources.length))
  const results = await verifyMultipleBalances(provider, sample)
  
  const mismatches = results.filter(r => !r.matches).length
  const mismatchPercentage = (mismatches / results.length) * 100

  return {
    total_checked: results.length,
    mismatches,
    mismatch_percentage: mismatchPercentage,
    seems_stale: mismatchPercentage > 20, // Consider stale if >20% mismatch
  }
} 