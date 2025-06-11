"use client"

import { useState } from "react"
import { useAccount, useDisconnect } from "@starknet-react/core"
import { useAuth } from "../providers/auth-provider"
import { useProgress } from "../providers/progress-provider"

import { fetchAllResourceBalances, type WithdrawableResource, type FetchResourcesResult, type ResourceBalance, type ProgressReporter } from "../lib/data-service"
import { ProgressDisplay } from "./progress-display"
import "./bridge.css"
import { type Call } from "starknet"

const BRIDGE_CONTRACT_ADDRESS = "0x01d490c9345ae1fc0c10c8fd69f6a9f31f893ba7486eae489b020eea1f8a8ef7"
// TODO: Replace with the actual client fee recipient address
const CLIENT_FEE_RECIPIENT = "0x06b525b0aaf7694a7e854f44ae0a4467c84c4e0111c15df7a6e2ab691bd77311"

export function BridgeOut() {
  const { account } = useAccount()
  const { walletAddress } = useAuth()
  const { disconnect } = useDisconnect()
  const { startProgress, addStep, updateStep, addSubStep, updateSubStep, completeStep, errorStep, completeProgress, resetProgress } = useProgress()
  const [isLoading, setIsLoading] = useState(false)
  const [isBridging, setIsBridging] = useState(false)
  const [resources, setResources] = useState<WithdrawableResource[]>([])
  const [allResourceData, setAllResourceData] = useState<FetchResourcesResult | null>(null)
  const [selectedResourceTypes, setSelectedResourceTypes] = useState<Set<string>>(new Set())
  const [lastFetchTime, setLastFetchTime] = useState<Date | null>(null)
  const [txHashes, setTxHashes] = useState<string[]>([])
  const [error, setError] = useState<Error | null>(null)
  const [successfulWithdrawals, setSuccessfulWithdrawals] = useState<string[]>([])
  const [failedWithdrawals, setFailedWithdrawals] = useState<string[]>([])

  // Filter resources based on selected resource types
  const filteredResources = resources.filter(resource => 
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

  const handleFetchResources = async () => {
    if (!walletAddress) {
      return
    }

    setIsLoading(true)
    setResources([])
    setAllResourceData(null)
    setSelectedResourceTypes(new Set())
    setTxHashes([])
    setError(null)
    setSuccessfulWithdrawals([])
    setFailedWithdrawals([])
    
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

    setIsBridging(true)
    setTxHashes([])
    setError(null)
    setSuccessfulWithdrawals([])
    setFailedWithdrawals([])

    console.log(`🚀 Let it rip! Processing ${calls.length} withdrawals individually...`)

    const allTxHashes: string[] = []
    let successCount = 0
    let failCount = 0

    // Process each withdrawal individually
    for (let i = 0; i < calls.length; i++) {
      const call = calls[i]
      const resource = filteredResources[i]
      const resourceName = `${resource.resource_name} from entity ${resource.entity_id}`
      
      console.log(`Processing withdrawal ${i + 1}/${calls.length}: ${resourceName}`)

      try {
        // First, try to estimate the fee to check if the transaction will succeed
        // This helps us catch failures before the wallet popup
        try {
          await account.estimateInvokeFee([call])
        } catch {
          // If fee estimation fails, the transaction will fail
          // Skip this one silently without showing wallet popup
          failCount++
          setFailedWithdrawals(prev => [...prev, resourceName])
          console.log(`⏭️ Skipping ${resourceName} - simulation failed (likely insufficient balance)`)
          continue
        }

        // If estimation succeeded, execute the transaction
        const result = await account.execute([call])
        allTxHashes.push(result.transaction_hash)
        successCount++
        
        setSuccessfulWithdrawals(prev => [...prev, resourceName])
        console.log(`✅ Success: ${resourceName}`)
        
        // Small delay between transactions to avoid rate limiting
        if (i < calls.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 200))
        }
      } catch (error: unknown) {
        failCount++
        setFailedWithdrawals(prev => [...prev, resourceName])
        
        console.error(`❌ Failed: ${resourceName}`, error)
        
        // Extract error message for logging
        let errorText = ''
        if (typeof error === 'string') {
          errorText = error
        } else if (error && typeof error === 'object') {
          if ('message' in error && typeof error.message === 'string') {
            errorText = error.message
          } else if ('toString' in error && typeof error.toString === 'function') {
            errorText = error.toString()
          }
        }
        
        console.log(`Error details: ${errorText}`)
        
        // Continue with next resource regardless of failure
        continue
      }
    }

    // Set all successful transaction hashes
    setTxHashes(allTxHashes)
    
    console.log(`🎯 Completed: ${successCount} successful, ${failCount} failed out of ${calls.length} total`)
    
    // Show summary
    if (failCount > 0 && successCount === 0) {
      setError(new Error(`All ${failCount} withdrawals failed. The indexer data appears to be stale.`))
    } else if (failCount > 0) {
      setError(new Error(`${failCount} withdrawals failed (likely stale data), but ${successCount} succeeded!`))
    }
    
    setIsBridging(false)
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
                  {/* Step 2: Select Resources */}
                  <div style={{ 
                    padding: '16px', 
                    border: '1px solid #333', 
                    borderRadius: '8px',
                    backgroundColor: '#1a1a1a'
                  }}>
                    <h3 style={{ margin: '0 0 8px 0', fontSize: '16px', color: '#fff' }}>
                      Step 2: Select Resources to Withdraw
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

                  <div className="alert">
                    <p className="alert-title">🚀 Ready to Bridge</p>
                    <p className="alert-description">
                      {filteredResources.length} resources selected for withdrawal.
                      <br/>
                      <strong>🎯 Individual Processing</strong>: Each withdrawal is sent separately - no batching, no bundling. 
                      Failed transactions won't affect successful ones!
                    </p>
                  </div>

                  {/* Step 3: Bridge Out */}
                  <div style={{ 
                    padding: '16px', 
                    border: '1px solid #333', 
                    borderRadius: '8px',
                    backgroundColor: '#1a1a1a'
                  }}>
                    <h3 style={{ margin: '0 0 8px 0', fontSize: '16px', color: '#fff' }}>
                      Step 3: Bridge Out Resources
                    </h3>
                    <button
                      onClick={() => handleBridgeOut()}
                      disabled={!calls.length || isBridging}
                      className="button"
                    >
                      {isBridging ? "Bridging..." : `Bridge Out ${selectedResourceTypes.size === 0 ? 'All' : 'Selected'} Resources (${filteredResources.length} items)`}
                    </button>
                  </div>
                </>
              )}
            </>
          )}

          {txHashes.length > 0 && (
            <div className="alert-success">
              <p className="alert-title">✅ Withdrawal Results</p>
              <div style={{ marginBottom: '12px' }}>
                <strong>Summary:</strong> {successfulWithdrawals.length} successful, {failedWithdrawals.length} failed
              </div>
              
              {successfulWithdrawals.length > 0 && (
                <details style={{ marginBottom: '12px' }}>
                  <summary style={{ cursor: 'pointer', fontWeight: 'bold', color: '#4ade80' }}>
                    ✅ Successful Withdrawals ({successfulWithdrawals.length})
                  </summary>
                  <ul style={{ margin: '8px 0 0 20px', padding: 0, fontSize: '12px' }}>
                    {successfulWithdrawals.map((item, idx) => (
                      <li key={idx}>{item}</li>
                    ))}
                  </ul>
                </details>
              )}
              
              {failedWithdrawals.length > 0 && (
                <details style={{ marginBottom: '12px' }}>
                  <summary style={{ cursor: 'pointer', fontWeight: 'bold', color: '#ff6666' }}>
                    ❌ Failed Withdrawals ({failedWithdrawals.length}) - Likely stale indexer data
                  </summary>
                  <ul style={{ margin: '8px 0 0 20px', padding: 0, fontSize: '12px' }}>
                    {failedWithdrawals.map((item, idx) => (
                      <li key={idx}>{item}</li>
                    ))}
                  </ul>
                </details>
              )}
              
              <div>
                <strong>Transaction Hashes:</strong>
                {txHashes.map((hash, index) => (
                  <div key={hash}>
                    <a
                      href={`https://starkscan.co/tx/${hash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline"
                    >
                      View Transaction {index + 1} on Starkscan
                    </a>
                  </div>
                ))}
              </div>
            </div>
          )}

          {error && txHashes.length === 0 && (
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
