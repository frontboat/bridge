"use client"

import { sepolia, mainnet, type Chain } from "@starknet-react/chains";
import {
  StarknetConfig,
  jsonRpcProvider,
  starkscan,
} from "@starknet-react/core";
import ControllerConnector from "@cartridge/connector/controller";
import { toSessionPolicies } from "@cartridge/controller";

const BRIDGE_CONTRACT_ADDRESS = "0x01d490c9345ae1fc0c10c8fd69f6a9f31f893ba7486eae489b020eea1f8a8ef7"

const policies = toSessionPolicies({
  contracts: {
    [BRIDGE_CONTRACT_ADDRESS]: {
      methods: [
        {
          name: "Withdraw Resources",
          description: "Withdraw a specific resource from a structure.",
          entrypoint: "withdraw"
        }
      ]
    }
  }
});

// Initialize the connector outside of the component
const connector = new ControllerConnector({
  policies,
  defaultChainId: '0x534e5f4d41494e', // MAINNET
  chains: [
    { rpcUrl: 'https://api.cartridge.gg/x/starknet/mainnet' },
    { rpcUrl: 'https://api.cartridge.gg/x/starknet/sepolia' },
  ],
});


// Configure RPC provider
const provider = jsonRpcProvider({
  rpc: (chain: Chain) => {
    switch (chain) {
      case mainnet:
        return { nodeUrl: 'https://api.cartridge.gg/x/starknet/mainnet' }
      case sepolia:
      default:
        return { nodeUrl: 'https://api.cartridge.gg/x/starknet/sepolia' }
    }
  },
})

export function StarknetProvider({ children }: { children: React.ReactNode }) {
  return (
    <StarknetConfig
      autoConnect
      chains={[mainnet, sepolia]}
      provider={provider}
      connectors={[connector]}
      explorer={starkscan}
    >
      {children}
    </StarknetConfig>
  );
}