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
const BATCH_SIZE = 50 // Max calls per transaction to avoid event limits

export function BridgeOut() {
  const { account } = useAccount()
  const { walletAddress } = useAuth()
  const { disconnect } = useDisconnect()
  const { startProgress, addStep, updateStep, addSubStep, updateSubStep, completeStep, errorStep, completeProgress, resetProgress } = useProgress()
  const [isLoading, setIsLoading] = useState(false)
  const [isBridging, setIsBridging] = useState(false)
  const [originalResources, setOriginalResources] = useState<WithdrawableResource[]>([])
  const [resources, setResources] = useState<WithdrawableResource[]>([])
  const [allResourceData, setAllResourceData] = useState<FetchResourcesResult | null>(null)
  const [txHashes, setTxHashes] = useState<string[]>([])
  const [error, setError] = useState<Error | null>(null)
  const [failedBatchInfo, setFailedBatchInfo] = useState<{ entityId: string; resourceName: string } | null>(null)

  const calls: Call[] = walletAddress
    ? resources.map((resource) => ({
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

  const handleFetchResources = async () => {
    if (!walletAddress) {
      return
    }

    setIsLoading(true)
    setResources([])
    setOriginalResources([])
    setAllResourceData(null)
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
    const callsToExecute = callsOverride || calls
    if (!callsToExecute.length) {
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

    const numBatches = Math.ceil(callsToExecute.length / BATCH_SIZE)
    console.log(
      `Preparing to submit ${callsToExecute.length} withdrawals in ${numBatches} batches.`,
    )

    try {
      for (let i = 0; i < numBatches; i++) {
        const batch = callsToExecute.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE)
        const batchNum = i + 1
        console.log(`Submitting batch ${batchNum} of ${numBatches}...`)

        const result = await account.execute(batch)
        setTxHashes((prev) => [...prev, result.transaction_hash])
        
        console.log(`Batch ${batchNum} submitted successfully.`)
      }
      console.log("All withdrawal batches have been submitted.")
    } catch (e: unknown) {
      console.error("Withdrawal failed on a batch", e)
      
      const errorText = (typeof e === 'string') ? e : (e as Error)?.message || ''
      const insufficientBalanceMatch = errorText.match(/Insufficient Balance: (\w+) \(id: (\d+),/i)
      
      if (insufficientBalanceMatch) {
        const resourceName = insufficientBalanceMatch[1]
        const entityId = insufficientBalanceMatch[2]
        setFailedBatchInfo({ entityId, resourceName })
        setError(new Error(`Insufficient ${resourceName} for entity ${entityId}.`))

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
          <button
            onClick={handleFetchResources}
            disabled={isLoading || isBridging}
            className="button"
          >
            {isLoading ? "Fetching..." : "1. Fetch All Resource Balances"}
          </button>

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

              <div style={{ maxHeight: '300px', overflowY: 'auto', border: '1px solid #ccc', borderRadius: '4px', padding: '8px', margin: '16px 0' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                  <thead>
                    <tr style={{ background: '#f5f5f5' }}>
                      <th style={{ padding: '4px', textAlign: 'left', border: '1px solid #ddd' }}>Entity</th>
                      <th style={{ padding: '4px', textAlign: 'left', border: '1px solid #ddd' }}>Resource</th>
                      <th style={{ padding: '4px', textAlign: 'center', border: '1px solid #ddd' }}>ID</th>
                      <th style={{ padding: '4px', textAlign: 'right', border: '1px solid #ddd' }}>Amount</th>
                      <th style={{ padding: '4px', textAlign: 'center', border: '1px solid #ddd' }}>Status</th>
                      <th style={{ padding: '4px', textAlign: 'center', border: '1px solid #ddd' }}>Whitelisted</th>
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
                      <tr key={index} style={{ 
                        background: balance.is_withdrawable ? '#e8f5e8' : '#f9f9f9'
                      }}>
                        <td style={{ padding: '4px', border: '1px solid #ddd' }}>{balance.entity_id}</td>
                        <td style={{ padding: '4px', border: '1px solid #ddd' }}>
                          <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <span style={{ fontWeight: 'bold' }}>{balance.resource_name}</span>
                            {balance.ticker && <span style={{ fontSize: '10px', color: '#666' }}>{balance.ticker}</span>}
                          </div>
                        </td>
                        <td style={{ padding: '4px', textAlign: 'center', border: '1px solid #ddd', fontSize: '10px', color: '#666' }}>
                          {balance.resource_id}
                        </td>
                        <td style={{ padding: '4px', textAlign: 'right', border: '1px solid #ddd' }}>
                          <span style={{ fontWeight: balance.is_withdrawable ? 'bold' : 'normal' }}>
                            {balance.amount_formatted}
                          </span>
                        </td>
                        <td style={{ padding: '4px', textAlign: 'center', border: '1px solid #ddd' }}>
                          {balance.is_withdrawable ? (
                            <span style={{ color: 'green', fontWeight: 'bold' }}>✓ Withdrawable</span>
                          ) : (
                            <span style={{ color: '#666' }}>Zero Balance</span>
                          )}
                        </td>
                        <td style={{ padding: '4px', textAlign: 'center', border: '1px solid #ddd' }}>
                          <span style={{ color: balance.is_whitelisted ? 'green' : 'red', fontWeight: 'bold' }}>
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
                    <p className="alert-title">Resources Ready for Withdrawal</p>
                    <p className="alert-description">
                      Found {resources.length} withdrawable resource stacks. 
                      This will be submitted in{" "}
                      {Math.ceil(calls.length / BATCH_SIZE)} separate
                      transactions.
                    </p>
                  </div>
                  <button
                    onClick={() => handleBridgeOut()}
                    disabled={!calls.length || isBridging}
                    className="button"
                  >
                    {isBridging && !failedBatchInfo ? "Bridging..." : "2. Bridge Out All Resources"}
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

          {error && !failedBatchInfo && (
            <div className="alert-destructive">
              <p className="alert-title">Transaction Error</p>
              <p>{error.message}</p>
            </div>
          )}

          {failedBatchInfo && (
                <div className="alert-destructive">
                  <p className="alert-title">Transaction Failed: Insufficient {failedBatchInfo.resourceName}</p>
                  <p>The withdrawal failed because entity {failedBatchInfo.entityId} has an insufficient balance of {failedBatchInfo.resourceName}.</p>
                  <p>You can retry without this specific withdrawal.</p>
                  <div style={{ marginTop: '1rem' }}>
                    <button onClick={handleRetryBridgeOut} disabled={isBridging} className="button">
                      {isBridging ? "Retrying..." : `Retry Without ${failedBatchInfo.resourceName}`}
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
