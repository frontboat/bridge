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
  const [hasVerified, setHasVerified] = useState(false)

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
      setHasVerified(true)

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
        setShowCorrectedBalances(true) // Auto-apply corrected balances
        console.log(`Applied corrections: ${corrected.filter(r => r.was_corrected).length} resources corrected, ${corrected.length} total resources remain`)
      } else {
        setCorrectedResources([])
        setShowCorrectedBalances(false)
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
    setAllResourceData(null)
    setSelectedResourceTypes(new Set())
    setVerificationResults(null)
    setTxHashes([])
    setError(null)
    setFailedBatchInfo(null)
    setHasVerified(false)
    setCorrectedResources([])
    setShowCorrectedBalances(false)
    
    // Start the progress tracking
    resetProgress()
    startProgress()
    
    try {
      const progressReporter = createProgressReporter()
      const resourceData = await fetchAllResourceBalances(walletAddress, progressReporter)
      setAllResourceData(resourceData)
      setResources(resourceData.withdrawable)
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

  const handleBridgeOut = async () => {
    if (!calls.length) {
      console.warn("No resources staged for withdrawal. Fetch resources first.")
      return
    }
    if (!account) {
      console.error("Wallet not connected or ready.")
      return
    }

    // Check if user has verified balances
    if (!hasVerified && resources.length > 0) {
      setError(new Error("Please verify balances first to ensure accurate withdrawals. Click 'Verify Balances' above."))
      return
    }

    setIsBridging(true)
    setTxHashes([])
    setError(null)
    setFailedBatchInfo(null)

    // Use smart batching with the filtered resources
    const smartBatches = createSmartBatches(calls, filteredResources)
    const numBatches = smartBatches.length
    
    console.log(
      `🧠 Smart batching: ${calls.length} withdrawals → ${numBatches} batches (avoiding resource conflicts)`,
    )

    const allTxHashes: string[] = []

    try {
      for (let i = 0; i < smartBatches.length; i++) {
        const batch = smartBatches[i]
        const batchNum = i + 1
        console.log(`Submitting smart batch ${batchNum} of ${numBatches} (${batch.length} calls)...`)

        try {
          const result = await account.execute(batch)
          allTxHashes.push(result.transaction_hash)
          
          console.log(`Smart batch ${batchNum} submitted successfully.`)
        } catch (batchError: unknown) {
          console.error(`Batch ${batchNum} failed:`, batchError)
          
          // Extract error message from various possible error formats
          let errorText = ''
          if (typeof batchError === 'string') {
            errorText = batchError
          } else if (batchError && typeof batchError === 'object') {
            if ('message' in batchError && typeof batchError.message === 'string') {
              errorText = batchError.message
            } else if ('toString' in batchError && typeof batchError.toString === 'function') {
              errorText = batchError.toString()
            } else {
              errorText = JSON.stringify(batchError)
            }
          }
          
          console.log("Extracted error text:", errorText)
          const insufficientBalanceMatch = errorText.match(/Insufficient Balance: (\w+) \(id: (\d+),/i)
          
          if (insufficientBalanceMatch) {
            const resourceName = insufficientBalanceMatch[1]
            
            // Find the specific resource that failed
            const failedResource = filteredResources.find(r => 
              r.resource_name.toUpperCase() === resourceName.toUpperCase()
            )
            
            if (failedResource) {
              setFailedBatchInfo({ entityId: failedResource.entity_id, resourceName: failedResource.resource_name })
              throw new Error(`Insufficient ${resourceName} for entity ${failedResource.entity_id}. The contract has insufficient balance for this withdrawal.`)
            }
          }
          
          throw batchError
        }
      }
      
      // All batches completed successfully
      setTxHashes(allTxHashes)
      console.log(`All ${numBatches} withdrawal batches have been submitted successfully.`)
      
    } catch (e: unknown) {
      // Set any successful transactions before the failure
      if (allTxHashes.length > 0) {
        setTxHashes(allTxHashes)
      }
      
      if (e instanceof Error) {
        setError(e)
      } else {
        setError(new Error("An unknown error occurred during withdrawal."))
      }
    } finally {
      setIsBridging(false)
    }
  }
  
  const handleRetryBridgeOut = async () => {
    if (!failedBatchInfo || !filteredResources.length || !walletAddress) return

    const retryResources = filteredResources.filter(
      (resource) =>
        !(
          resource.entity_id === failedBatchInfo.entityId &&
          resource.resource_name === failedBatchInfo.resourceName
        ),
    )

    if (retryResources.length === filteredResources.length) {
      console.error("Could not find the failing resource to exclude. Please fetch again.")
      return
    }

    console.log(`Retrying withdrawal without ${failedBatchInfo.resourceName} for entity ${failedBatchInfo.entityId}.`)

    // Update the resources to exclude the failed one
    setResources(retryResources)
    setFailedBatchInfo(null)
    setError(null)

    // Retry with the filtered resources
    await handleBridgeOut()
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
            wallet. Follow the steps below to ensure successful withdrawals.
          </p>
        </div>
        <div className="card-content">
          <div className="flex-col-gap">
          
          {/* Step 1: Fetch Resources */}
          <div style={{ 
            padding: '16px', 
            border: '1px solid #333', 
            borderRadius: '8px',
            backgroundColor: '#1a1a1a'
          }}>
            <h3 style={{ margin: '0 0 8px 0', fontSize: '16px', color: '#fff' }}>
              Step 1: Fetch Resources
            </h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <button
                onClick={handleFetchResources}
                disabled={isLoading || isBridging}
                className="button"
              >
                {isLoading ? "Fetching..." : "Fetch All Resource Balances"}
              </button>
              {lastFetchTime && (
                <div style={{ fontSize: '12px', color: '#666' }}>
                  Last updated: {lastFetchTime.toLocaleTimeString()}
                </div>
              )}
            </div>
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

              {/* Step 2: Verify Balances */}
              <div style={{ 
                padding: '16px', 
                border: '1px solid #333', 
                borderRadius: '8px',
                backgroundColor: hasVerified ? '#1a2c27' : '#1a1a1a',
                borderColor: hasVerified ? '#00a854' : '#333'
              }}>
                <h3 style={{ margin: '0 0 8px 0', fontSize: '16px', color: '#fff' }}>
                  Step 2: Verify Balances {hasVerified && '✅'}
                </h3>
                <p style={{ fontSize: '14px', color: '#888', margin: '0 0 12px 0' }}>
                  Verify balances against live contracts to prevent failed transactions
                </p>
                <button
                  onClick={handleVerifyBalances}
                  disabled={isVerifying || isBridging || resources.length === 0}
                  className="button"
                  style={{ 
                    backgroundColor: hasVerified ? '#00a854' : '#0070f3',
                  }}
                >
                  {isVerifying ? "Verifying..." : hasVerified ? "Re-verify Balances" : "Verify Balances"}
                </button>
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
                  {/* Step 3: Select Resources */}
                  <div style={{ 
                    padding: '16px', 
                    border: '1px solid #333', 
                    borderRadius: '8px',
                    backgroundColor: '#1a1a1a'
                  }}>
                    <h3 style={{ margin: '0 0 8px 0', fontSize: '16px', color: '#fff' }}>
                      Step 3: Select Resources to Withdraw
                    </h3>
                    <p style={{ fontSize: '14px', color: '#888', margin: '0 0 12px 0' }}>
                      Choose which resource types to withdraw. Leave empty to withdraw all.
                    </p>
                    <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
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
                        const resourceCount = activeResources.filter(r => r.resource_name === resourceType).length
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

                  <div className="alert">
                    <p className="alert-title">🚀 Ready to Bridge</p>
                    <p className="alert-description">
                      {showCorrectedBalances ? 
                        `Using verified contract balances. ${filteredResources.length} resources ready for withdrawal.` :
                        `${filteredResources.length} resources selected for withdrawal.`
                      }
                      <br/>
                      <strong>🧠 Smart batching</strong>: Will group these into{" "}
                      {createSmartBatches(calls, filteredResources).length} optimized
                      transactions to prevent conflicts.
                    </p>
                  </div>

                  {/* Step 4: Bridge Out */}
                  <div style={{ 
                    padding: '16px', 
                    border: '1px solid #333', 
                    borderRadius: '8px',
                    backgroundColor: '#1a1a1a'
                  }}>
                    <h3 style={{ margin: '0 0 8px 0', fontSize: '16px', color: '#fff' }}>
                      Step 4: Bridge Out Resources
                    </h3>
                    <button
                      onClick={() => handleBridgeOut()}
                      disabled={!calls.length || isBridging || !hasVerified}
                      className="button"
                      style={{
                        backgroundColor: !hasVerified ? '#666' : '#0070f3',
                        cursor: !hasVerified ? 'not-allowed' : 'pointer'
                      }}
                    >
                      {isBridging ? "Bridging..." : `Bridge Out ${selectedResourceTypes.size === 0 ? 'All' : 'Selected'} Resources (${filteredResources.length} items)`}
                    </button>
                    {!hasVerified && resources.length > 0 && (
                      <p style={{ fontSize: '12px', color: '#ff6666', marginTop: '8px' }}>
                        ⚠️ Please verify balances first (Step 2) to ensure successful withdrawals
                      </p>
                    )}
                  </div>
                </>
              )}
            </>
          )}

          {txHashes.length > 0 && (
            <div className="alert-success">
              <p className="alert-title">✅ Transactions Submitted!</p>
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
                  <p><strong>This resource has been excluded.</strong> You can retry without it.</p>
                  <div style={{ marginTop: '1rem' }}>
                    <button onClick={handleRetryBridgeOut} disabled={isBridging} className="button" style={{ backgroundColor: '#f59e0b', color: 'white' }}>
                      {isBridging ? "Retrying..." : `🔄 Retry Without ${failedBatchInfo.resourceName} (Entity ${failedBatchInfo.entityId})`}
                    </button>
                  </div>
                </div>
            )}

          {error && !failedBatchInfo && (
                <div className="alert-destructive">
                  <p className="alert-title">🚨 Error</p>
                  <p>{error.message}</p>
                </div>
            )}

          <button className="button" onClick={() => disconnect()}>Disconnect</button>
        </div>
      </div>
    </div>
  </div>
  )
}
