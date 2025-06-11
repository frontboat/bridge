"use client"

import type React from "react"
import { createContext, useContext } from "react"
import { useAccount } from "@starknet-react/core"

type AuthContextType = {
  walletAddress: string | undefined
  isAuthenticated: boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { address, isConnected } = useAccount()

  const value: AuthContextType = {
    walletAddress: address,
    isAuthenticated: isConnected,
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider")
  }
  return context
} 