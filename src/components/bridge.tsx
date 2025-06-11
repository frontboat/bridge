"use client"

import { useState } from "react"
import { useAccount, useDisconnect, useProvider } from "@starknet-react/core"
import { useAuth } from "../providers/auth-provider"
import { useProgress } from "../providers/progress-provider"

import { fetchAllResourceBalances, type WithdrawableResource, type FetchResourcesResult, type ResourceBalance, type ProgressReporter } from "../lib/data-service"
import { checkDataFreshness, verifyMultipleBalances, applyCorrectedBalances } from "../lib/contract-verifier"
import { ProgressDisplay } from "./progress-display"
import "./bridge.css"
import { type Call } from "starknet"

const BRIDGE_CONTRACT_ADDRESS = "0x01d490c9345ae1fc0c10c8fd69f6a9f31f893ba7486eae489b020eea1f8a8ef7"
// TODO: Replace with the actual client fee recipient address
const CLIENT_FEE_RECIPIENT = "0x06b525b0aaf7694a7e854f44ae0a4467c84c4e0111c15df7a6e2ab691bd77311"
const BATCH_SIZE = 50 // Max calls per transaction to avoid event limits

// Smart batching function to avoid resource type conflicts
function createSmartBatches(calls: Call[], resources: WithdrawableResource[]): Call[][] {
  console.log(`🧠 Smart batching debug:`)
  console.log(`- Calls length: ${calls.length}`)
  console.log(`- Resources length: ${resources.length}`)
  
  if (calls.length !== resources.length) {
    console.error(`❌ Mismatch: calls (${calls.length}) vs resources (${resources.length})`)
    // Fall back to simple batching if there's a mismatch
    const batches: Call[][] = []
    for (let i = 0; i < calls.length; i += BATCH_SIZE) {
      batches.push(calls.slice(i, i + BATCH_SIZE))
    }
    return batches
  }
  
  const batches: Call[][] = []
  const resourceTypesSeen = new Set<string>()
  let currentBatch: Call[] = []
  
  // Group resources by type first for better understanding
  const resourcesByType: Record<string, number> = {}
  resources.forEach(r => {
    resourcesByType[r.resource_name] = (resourcesByType[r.resource_name] || 0) + 1
  })
  
  console.log('Resource distribution:', resourcesByType)
  
  for (let i = 0; i < calls.length; i++) {
    const call = calls[i]
    const resource = resources[i]
    const resourceType = resource.resource_name
    
    console.log(`Processing ${i}: ${resourceType} (entity ${resource.entity_id})`)
    
    // If this resource type is already in the current batch, start a new batch
    if (resourceTypesSeen.has(resourceType)) {
      console.log(`  → Resource type ${resourceType} already in batch, starting new batch`)
      if (currentBatch.length > 0) {
        batches.push([...currentBatch])
        console.log(`  → Batch ${batches.length} created with ${currentBatch.length} calls`)
        currentBatch = []
        resourceTypesSeen.clear()
      }
    }
    
    // If current batch is at max size, start a new batch
    if (currentBatch.length >= BATCH_SIZE) {
      console.log(`  → Batch size limit reached, starting new batch`)
      batches.push([...currentBatch])
      console.log(`  → Batch ${batches.length} created with ${currentBatch.length} calls`)
      currentBatch = []
      resourceTypesSeen.clear()
    }
    
    currentBatch.push(call)
    resourceTypesSeen.add(resourceType)
    console.log(`  → Added to batch, now has types: ${Array.from(resourceTypesSeen).join(', ')}`)
  }
  
  // Add the last batch if it has content
  if (currentBatch.length > 0) {
    batches.push([...currentBatch])
    console.log(`→ Final batch ${batches.length} created with ${currentBatch.length} calls`)
  }
  
  console.log(`🎯 Smart batching result: ${batches.length} batches`)
  batches.forEach((batch, i) => {
    console.log(`  Batch ${i + 1}: ${batch.length} calls`)
  })
  
  return batches
}

export function BridgeOut() {
  const { account } = useAccount()
  const { provider } = useProvider()
  const { walletAddress } = useAuth()
  const { disconnect } = useDisconnect()
  const { startProgress, addStep, updateStep, addSubStep, updateSubStep, completeStep, errorStep, completeProgress, resetProgress } = useProgress()
  const [isLoading, setIsLoading] = useState(false)
  const [isBridging, setIsBridging] = useState(false)
  const [originalResources, setOriginalResources] = useState<WithdrawableResource[]>([])
  const [resources, setResources] = useState<WithdrawableResource[]>([])
  const [allResourceData, setAllResourceData] = useState<FetchResourcesResult | null>(null)
  const [selectedResourceTypes, setSelectedResourceTypes] = useState<Set<string>>(new Set())
  const [lastFetchTime, setLastFetchTime] = useState<Date | null>(null)
  const [isVerifying, setIsVerifying] = useState(false)
  const [verificationResults, setVerificationResults] = useState<{
    total_checked: number;
    mismatches: number;
    mismatch_percentage: number;
    seems_stale: boolean;
  } | null>(null)
  const [correctedResources, setCorrectedResources] = useState<WithdrawableResource[]>([])
  const [showCorrectedBalances, setShowCorrectedBalances] = useState(false)
  const [txHashes, setTxHashes] = useState<string[]>([])
  const [error, setError] = useState<Error | null>(null)
  const [failedBatchInfo, setFailedBatchInfo] = useState<{ entityId: string; resourceName: string } | null>(null)

  // Use corrected resources if available, otherwise use original resources
  const activeResources = showCorrectedBalances && correctedResources.length > 0 ? correctedResources : resources
  
  // Filter resources based on selected resource types
  const filteredResources = activeResources.filter(resource => 
    selectedResourceTypes.size === 0 || selectedResourceTypes.has(resource.resource_name)
  )

  const calls: Call[] = walletAddress
    ? filteredResources.map((resource) => ({
        contractAddress: BRIDGE_CONTRACT_ADDRESS,
        entrypoint: "withdraw",
        calldata: [
          parseInt(resource.entity_id, 10), // from_structure_id (u32)
          walletAddress, // to_address
          resource.resource_contract_address, // token
          resource.amount, // amount (u128)
          CLIENT_FEE_RECIPIENT, // client_fee_recipient
        ],
      }))
    : []

  const createProgressReporter = (): ProgressReporter => ({
    startStep: (stepId: string, name: string, detail?: string) => {
      addStep({ id: stepId, name, detail });
      updateStep(stepId, { status: 'in-progress' });
    },
    updateStep: (stepId: string, detail: string) => {
      updateStep(stepId, { detail });
    },
    addSubStep: (stepId: string, subStepId: string, name: string) => {
      addSubStep(stepId, { id: subStepId, name });
    },
    updateSubStep: (stepId: string, subStepId: string, updates) => {
      updateSubStep(stepId, subStepId, updates);
    },
    completeStep: (stepId: string, detail?: string) => {
      completeStep(stepId, detail);
    },
    errorStep: (stepId: string, error: string) => {
      errorStep(stepId, error);
    }
  });

  // Get unique resource types for selection
  const getUniqueResourceTypes = () => {
    const uniqueTypes = new Set(resources.map(r => r.resource_name))
    return Array.from(uniqueTypes).sort()
  }

  // Toggle resource type selection
  const toggleResourceType = (resourceType: string) => {
    const newSelected = new Set(selectedResourceTypes)
    if (newSelected.has(resourceType)) {
      newSelected.delete(resourceType)
    } else {
      newSelected.add(resourceType)
    }
    setSelectedResourceTypes(newSelected)
  }

  // Select all resource types
  const selectAllResourceTypes = () => {
    setSelectedResourceTypes(new Set(getUniqueResourceTypes()))
  }

  // Clear all selections
  const clearAllResourceTypes = () => {
    setSelectedResourceTypes(new Set())
  }

  // Verify resource balances against contracts
  const handleVerifyBalances = async () => {
    if (!provider || !resources.length) {
      return
    }

    setIsVerifying(true)
    setVerificationResults(null)
    setError(null)

    try {
      const resourcesForVerification = resources.map(r => ({
        entity_id: r.entity_id,
        resource_name: r.resource_name,
        amount: r.amount
      }))

      const results = await checkDataFreshness(provider, resourcesForVerification, 5)
      setVerificationResults(results)

      if (results.seems_stale) {
        console.warn("Data appears to be stale based on contract verification")
        
        // Get detailed verification results for all resources
        const detailedResults = await verifyMultipleBalances(provider, resourcesForVerification)
        
        // Apply corrections to get resources with actual contract balances
        const corrected = applyCorrectedBalances(resources, detailedResults)
        
        // Convert back to WithdrawableResource format
        const correctedWithdrawable: WithdrawableResource[] = corrected.map(resource => {
          const originalResource = resources.find(r => 
            r.entity_id === resource.entity_id && r.resource_name === resource.resource_name
          )!
          return {
            ...originalResource,
            amount: resource.amount,
          }
        })
        
        setCorrectedResources(correctedWithdrawable)
        console.log(`Applied corrections: ${corrected.filter(r => r.was_corrected).length} resources corrected, ${corrected.length} total resources remain`)
      } else {
        setCorrectedResources([])
      }
    } catch (err) {
      console.error("Error verifying balances:", err)
      if (err instanceof Error) {
        setError(new Error(`Balance verification failed: ${err.message}`))
      }
    } finally {
      setIsVerifying(false)
    }
  }

  const handleFetchResources = async () => {
    if (!walletAddress) {
      return
    }

    setIsLoading(true)
    setResources([])
    setOriginalResources([])
    setAllResourceData(null)
    setSelectedResourceTypes(new Set())
    setVerificationResults(null)
    setTxHashes([])
    setError(null)
    setFailedBatchInfo(null)
    
    // Start the progress tracking
    resetProgress()
    startProgress()
    
    try {
      const progressReporter = createProgressReporter()
      const resourceData = await fetchAllResourceBalances(walletAddress, progressReporter)
      setAllResourceData(resourceData)
      setResources(resourceData.withdrawable)
      setOriginalResources(resourceData.withdrawable)
      setLastFetchTime(new Date())

      completeProgress()
    } catch (err) {
      console.error(err)
      if (err instanceof Error) {
        setError(err)
      }
    } finally {
      setIsLoading(false)
    }
  }

  const handleBridgeOut = async (callsOverride?: Call[]) => {
    // If no calls override provided, automatically verify balances first
    if (!callsOverride) {
      console.log("🔍 Auto-verifying balances before withdrawal to prevent failures...")
      
      setIsBridging(true)
      setError(null)
      setVerificationResults(null)
      
      try {
        // Auto-verify balances first
        await handleVerifyBalances()
        
        // Wait a moment for verification to complete
        await new Promise(resolve => setTimeout(resolve, 1000))
        
        // Check if we have corrected resources and auto-apply them
        if (correctedResources.length > 0) {
          console.log("✨ Auto-applying corrected balances to prevent failures")
          setShowCorrectedBalances(true)
          
          // Use corrected resources for withdrawal
          const correctedCalls: Call[] = correctedResources.map((resource) => ({
            contractAddress: BRIDGE_CONTRACT_ADDRESS,
            entrypoint: "withdraw",
            calldata: [
              parseInt(resource.entity_id, 10),
              walletAddress!,
              resource.resource_contract_address,
              resource.amount,
              CLIENT_FEE_RECIPIENT,
            ],
          }))
          
          console.log(`🎯 Proceeding with ${correctedCalls.length} verified resources (${filteredResources.length - correctedCalls.length} filtered out)`)
          
          // Proceed with verified calls
          return handleBridgeOut(correctedCalls)
        }
      } catch (error) {
        console.error("Auto-verification failed:", error)
        setError(new Error("Pre-verification failed. Please try manual verification."))
        setIsBridging(false)
        return
      }
    }

    // Rest of the original function...
    const callsToExecute = callsOverride || calls
    if (!callsToExecute.length) {
      console.warn("No resources staged for withdrawal. Fetch resources first.")
      setIsBridging(false)
      return
    }
    if (!account) {
      console.error("Wallet not connected or ready.")
      setIsBridging(false)
      return
    }

    if (!callsOverride) {
      setIsBridging(true)
      setTxHashes([])
      setError(null)
      setVerificationResults(null) // Clear old verification results
    }

    // Use smart batching to avoid resource type conflicts
    // We need to determine the correct resources that match the calls being executed
    let resourcesForBatching: WithdrawableResource[]
    
    if (callsOverride) {
      // For overridden calls (like retry), we need to figure out which resources match
      // This is tricky because calls don't contain resource info directly
      console.log('Using call override, need to match resources to calls')
      
      // Extract entity IDs from calls to match with resources
      const entityIdsInCalls = callsToExecute.map(call => call.calldata[0].toString())
      const contractAddressesInCalls = callsToExecute.map(call => call.calldata[2])
      
      console.log('Entity IDs in calls:', entityIdsInCalls)
      console.log('Contract addresses in calls:', contractAddressesInCalls)
      
      // Try to match resources to calls based on entity ID and contract address
      resourcesForBatching = []
      for (let i = 0; i < callsToExecute.length; i++) {
        const call = callsToExecute[i]
        const entityId = call.calldata[0].toString()
        const contractAddress = call.calldata[2]
        
        // Find matching resource
        const matchingResource = (originalResources.length > 0 ? originalResources : filteredResources)
          .find(r => r.entity_id === entityId && r.resource_contract_address === contractAddress)
        
        if (matchingResource) {
          resourcesForBatching.push(matchingResource)
        } else {
          console.warn(`Could not find matching resource for call ${i} (entity ${entityId})`)
          // Create a dummy resource to maintain array alignment
          resourcesForBatching.push({
            entity_id: entityId,
            resource_name: 'UNKNOWN',
            resource_contract_address: contractAddress,
            amount: '0',
            resource_id: 1 // Default to stone ID
          })
        }
      }
    } else {
      // Normal case - use filtered resources
      resourcesForBatching = filteredResources
    }
    
    console.log(`Resources for batching: ${resourcesForBatching.length}`)
    console.log(`Calls to execute: ${callsToExecute.length}`)
    
    const smartBatches = createSmartBatches(callsToExecute, resourcesForBatching)
    const numBatches = smartBatches.length
    
    console.log(
      `🧠 Smart batching: ${callsToExecute.length} withdrawals → ${numBatches} batches (avoiding resource conflicts)`,
    )

    try {
      for (let i = 0; i < smartBatches.length; i++) {
        const batch = smartBatches[i]
        const batchNum = i + 1
        console.log(`Submitting smart batch ${batchNum} of ${numBatches} (${batch.length} calls)...`)

        const result = await account.execute(batch)
        setTxHashes((prev) => [...prev, result.transaction_hash])
        
        console.log(`Smart batch ${batchNum} submitted successfully.`)
      }
      console.log("All withdrawal batches have been submitted.")
    } catch (e: unknown) {
      console.error("Withdrawal failed on a batch:", e)
      
      // Extract error message from various possible error formats
      let errorText = ''
      if (typeof e === 'string') {
        errorText = e
      } else if (e && typeof e === 'object') {
        if ('message' in e && typeof e.message === 'string') {
          errorText = e.message
        } else if ('toString' in e && typeof e.toString === 'function') {
          errorText = e.toString()
        } else {
          errorText = JSON.stringify(e)
        }
      }
      
      console.log("Extracted error text:", errorText)
      const insufficientBalanceMatch = errorText.match(/Insufficient Balance: (\w+) \(id: (\d+),/i)
      
      if (insufficientBalanceMatch) {
        const resourceName = insufficientBalanceMatch[1]
        const entityId = insufficientBalanceMatch[2]
        setFailedBatchInfo({ entityId, resourceName })
        setError(new Error(`Insufficient ${resourceName} for entity ${entityId}. This indicates stale indexer data - the indexer shows a balance but the contract has 0 or insufficient balance. Click retry to exclude this resource and continue.`))

      } else if (e instanceof Error) {
        setError(e)
      } else {
        setError(new Error("An unknown error occurred during withdrawal."))
      }
    } finally {
      setIsBridging(false)
    }
  }
  
  const handleRetryBridgeOut = async () => {
    if (!failedBatchInfo || !originalResources.length || !walletAddress) return

    const filteredResources = originalResources.filter(
      (resource) =>
        !(
          resource.entity_id === failedBatchInfo.entityId &&
          resource.resource_name.toUpperCase() === failedBatchInfo.resourceName.toUpperCase()
        ),
    )

    if (filteredResources.length === originalResources.length) {
      console.error("Could not find the failing resource to exclude. Please fetch again.")
      return
    }

    console.log(`Retrying withdrawal without ${failedBatchInfo.resourceName} for entity ${failedBatchInfo.entityId}.`)

    const newCalls: Call[] = filteredResources.map((resource) => ({
          contractAddress: BRIDGE_CONTRACT_ADDRESS,
          entrypoint: "withdraw",
          calldata: [
            parseInt(resource.entity_id, 10),
            walletAddress,
            resource.resource_contract_address,
            resource.amount,
            CLIENT_FEE_RECIPIENT,
          ],
        }))

    setResources(filteredResources)
    setFailedBatchInfo(null)
    setError(null)

    await handleBridgeOut(newCalls)
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      width: '100%',
      padding: '5rem 0 2rem 0',
      boxSizing: 'border-box'
    }}>
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Bridge Out Resources</h2>
          <p className="card-description">
            Withdraw all available resources from your realms and villages to your
            wallet. This will stage one or more batched transactions.
          </p>
        </div>
        <div className="card-content">
          <div className="flex-col-gap">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <button
              onClick={handleFetchResources}
              disabled={isLoading || isBridging}
              className="button"
            >
              {isLoading ? "Fetching..." : "1. Fetch All Resource Balances"}
            </button>
            {lastFetchTime && (
              <div style={{ fontSize: '12px', color: '#666' }}>
                Last updated: {lastFetchTime.toLocaleTimeString()}
              </div>
            )}
            {resources.length > 0 && (
              <button
                onClick={handleVerifyBalances}
                disabled={isVerifying || isBridging}
                className="button"
                style={{ marginLeft: '8px', fontSize: '12px', padding: '6px 12px' }}
              >
                {isVerifying ? "Verifying..." : "Verify Balances"}
              </button>
            )}
          </div>

          <ProgressDisplay />

          {allResourceData && (
            <>
              <div className="alert">
                <p className="alert-title">Resource Balance Overview</p>
                <p className="alert-description">
                  Checked {allResourceData.summary.total_resources_checked} resource balances 
                  across {allResourceData.summary.total_entities} structures. 
                  Found {allResourceData.summary.withdrawable_count} withdrawable resources.
                </p>
              </div>

              <div className="alert" style={{ backgroundColor: '#2d2a1f', borderColor: '#4a4520', color: '#fbbf24' }}>
                <p className="alert-title">📊 Data Source & Verification</p>
                <p className="alert-description">
                  This data comes from the Eternum indexer, which may lag behind the actual blockchain state by a few minutes. 
                  <strong> Use "Verify Balances" to check against live contracts</strong> for the most accurate data. 
                  Our system can automatically detect stale data and correct balances using real contract calls.
                </p>
                <div style={{ marginTop: '8px', fontSize: '12px', color: '#92847a' }}>
                  💡 <strong>Pro tip:</strong> Contract verification ensures you only withdraw what's actually available, preventing failed transactions.
                </div>
              </div>

              {verificationResults && (
                <div className={`alert${verificationResults.seems_stale ? '-destructive' : ''}`} style={{ 
                  backgroundColor: verificationResults.seems_stale ? '#fee2e2' : '#ecfdf5',
                  borderColor: verificationResults.seems_stale ? '#fecaca' : '#bbf7d0'
                }}>
                  <p className="alert-title">
                    {verificationResults.seems_stale ? '⚠️ Stale Data Detected' : '✅ Data Verification Complete'}
                  </p>
                  <p className="alert-description">
                    Verified {verificationResults.total_checked} resource balances against contracts. 
                    Found {verificationResults.mismatches} mismatches ({verificationResults.mismatch_percentage.toFixed(1)}%).
                    {verificationResults.seems_stale && correctedResources.length > 0 && (
                      <><br/><strong>✨ Good news:</strong> We've automatically corrected the balances using actual contract data. You can now withdraw the real available amounts!</>
                    )}
                  </p>
                  {verificationResults.seems_stale && correctedResources.length > 0 && (
                    <div style={{ marginTop: '12px', display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '14px' }}>
                        <input
                          type="checkbox"
                          checked={showCorrectedBalances}
                          onChange={(e) => setShowCorrectedBalances(e.target.checked)}
                        />
                        <strong>Use corrected balances from contracts ({correctedResources.length} resources)</strong>
                      </label>
                    </div>
                  )}
                </div>
              )}

              <div className="resource-table">
                <table>
                  <thead>
                    <tr>
                      <th>Entity</th>
                      <th>Resource</th>
                      <th style={{ textAlign: 'center' }}>ID</th>
                      <th style={{ textAlign: 'right' }}>Amount</th>
                      <th style={{ textAlign: 'center' }}>Status</th>
                      <th style={{ textAlign: 'center' }}>Whitelisted</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allResourceData.all_balances.sort((a, b) => {
                      // Sort by withdrawable first, then by entity, then by resource name
                      if (a.is_withdrawable !== b.is_withdrawable) {
                        return a.is_withdrawable ? -1 : 1;
                      }
                      if (a.entity_id !== b.entity_id) {
                        return Number(a.entity_id) - Number(b.entity_id);
                      }
                      return a.resource_name.localeCompare(b.resource_name);
                    }).map((balance: ResourceBalance, index: number) => (
                      <tr key={index} className={balance.is_withdrawable ? 'withdrawable-row' : 'non-withdrawable-row'}>
                        <td>{balance.entity_id}</td>
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <span style={{ fontWeight: 'bold' }}>{balance.resource_name}</span>
                            {balance.ticker && <span style={{ fontSize: '10px', color: '#888' }}>{balance.ticker}</span>}
                          </div>
                        </td>
                        <td style={{ textAlign: 'center', fontSize: '10px', color: '#888' }}>
                          {balance.resource_id}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <span style={{ fontWeight: balance.is_withdrawable ? 'bold' : 'normal' }}>
                            {balance.amount_formatted}
                          </span>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          {balance.is_withdrawable ? (
                            <span className="status-positive">✓ Withdrawable</span>
                          ) : (
                            <span className="status-neutral">Zero Balance</span>
                          )}
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <span className={balance.is_whitelisted ? 'status-positive' : 'status-negative'}>
                            {balance.is_whitelisted ? '✓' : '✗'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {resources.length > 0 && (
                <>
                  <div className="alert">
                    <p className="alert-title">🚀 Resources Ready for Withdrawal</p>
                    <p className="alert-description">
                      Found {resources.length} withdrawable resource stacks. 
                      {selectedResourceTypes.size === 0 ? "All resource types will be withdrawn" : `${selectedResourceTypes.size} resource type(s) selected`}.
                      <br/>
                      <strong>🧠 Smart batching</strong>: Will group these into{" "}
                      {createSmartBatches(calls, filteredResources).length} optimized
                      transactions (preventing same-resource conflicts that cause failures).
                    </p>
                  </div>

                  <div className="alert">
                    <p className="alert-title">Select Resources to Withdraw</p>
                    <p className="alert-description">
                      !!! SO IDK WHY, BUT GO THROUGH AND ONLY SELECT 1 RESOURCE, HIT SUBMIT, ITLL GO THRU, GIVE YOU AN ERROR, BUT IT WENT THRU. REPEAT FOR THE RESOURCES !!! SO JANK BUT BRAIN HURT NO TIME 
                    </p>
                    <div style={{ display: 'flex', gap: '8px', marginTop: '12px', marginBottom: '12px' }}>
                      <button onClick={selectAllResourceTypes} className="button" style={{ fontSize: '12px', padding: '4px 8px' }}>
                        Select All
                      </button>
                      <button onClick={clearAllResourceTypes} className="button" style={{ fontSize: '12px', padding: '4px 8px' }}>
                        Clear All
                      </button>
                    </div>
                    <div className="resource-selection">
                      {getUniqueResourceTypes().map((resourceType) => {
                        const isSelected = selectedResourceTypes.has(resourceType)
                        const resourceCount = resources.filter(r => r.resource_name === resourceType).length
                        return (
                          <label key={resourceType} className={`resource-checkbox ${isSelected ? 'selected' : ''}`}>
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleResourceType(resourceType)}
                            />
                            <span style={{ fontWeight: 'bold' }}>
                              {resourceType} ({resourceCount})
                            </span>
                          </label>
                        )
                      })}
                    </div>
                  </div>

                  <button
                    onClick={() => handleBridgeOut()}
                    disabled={!calls.length || isBridging}
                    className="button"
                  >
                    {isBridging && !failedBatchInfo ? "Auto-Verifying & Smart Bridging..." : `2. Auto-Verify & Smart Bridge Out ${selectedResourceTypes.size === 0 ? 'All' : 'Selected'} Resources (${filteredResources.length} items)`}
                  </button>
                </>
              )}
            </>
          )}

          {txHashes.length > 0 && (
            <div className="alert-success">
              <p className="alert-title">Transactions Submitted!</p>
              <div>
                {txHashes.map((hash, index) => (
                  <div key={hash}>
                    <a
                      href={`https://starkscan.co/tx/${hash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline"
                    >
                      View Batch {index + 1} on Starkscan
                    </a>
                  </div>
                ))}
              </div>
            </div>
          )}

          {failedBatchInfo && (
                <div className="alert-destructive">
                  <p className="alert-title">🚨 Transaction Failed: Insufficient {failedBatchInfo.resourceName}</p>
                  <p>The withdrawal failed because entity {failedBatchInfo.entityId} has an insufficient balance of {failedBatchInfo.resourceName}.</p>
                  <p><strong>This confirms the indexer data is stale.</strong> You can retry without this specific withdrawal.</p>
                  <div style={{ marginTop: '1rem' }}>
                    <button onClick={handleRetryBridgeOut} disabled={isBridging} className="button" style={{ backgroundColor: '#f59e0b', color: 'white' }}>
                      {isBridging ? "Retrying..." : `🔄 Retry Without ${failedBatchInfo.resourceName} (Entity ${failedBatchInfo.entityId})`}
                    </button>
                  </div>
                </div>
            )}

          {error && !failedBatchInfo && txHashes.length === 0 && (
                <div className="alert-destructive">
                  <p className="alert-title">🚨 Transaction Failed</p>
                  <p>{error.message}</p>
                  <p><strong>Try refreshing the data and selecting only specific resources to withdraw.</strong></p>
                  <div style={{ marginTop: '1rem' }}>
                    <button onClick={handleFetchResources} disabled={isLoading} className="button" style={{ backgroundColor: '#3b82f6', color: 'white' }}>
                      {isLoading ? "Refreshing..." : "🔄 Refresh Data"}
                    </button>
                  </div>
                </div>
            )}

          <button className="button" onClick={() => disconnect()}>Disconnect</button>
        </div>
      </div>
    </div>
  </div>
  )
}
