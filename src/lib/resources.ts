/* eslint-disable @typescript-eslint/no-explicit-any */
// This is a placeholder. You should replace this with the actual resources import.
const resources: any[] = []; 

export const findResourceById = (value: number) => {
  return resources.find((e) => e.id === value);
};

export const findResourceIdByTrait = (trait: string) => {
  //
  return resources.find((e) => e?.trait === trait).id;
};

// if it's labor, then remove 28 to get the icon resource id
export const getIconResourceId = (resourceId: number) => {
  return resourceId;
};

export const RESOURCE_PRECISION = 1_000_000_000;
export const RESOURCE_PRECISION_MULTIPLIER = 1_000_000_000; // 1e9
export const RESOURCE_MULTIPLIER = 1000;
// Bridge Fees (using 10_000 precision)
export const BRIDGE_FEE_DENOMINATOR = 10_000;

// API Query Function
export async function queryEternumAPI(query: string): Promise<any> {
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

// Helper function to convert hex values with resource precision
export function hexToResourceValue(hex: string | null | undefined): number {
  if (!hex || typeof hex !== "string" || !hex.startsWith("0x") || hex === "0x") {
    return 0;
  }
  try {
    const bigIntValue = BigInt(hex);
    return Number(bigIntValue) / RESOURCE_PRECISION_MULTIPLIER;
  } catch (e) {
    console.error("Error converting hex to resource value:", hex, e);
    return 0;
  }
} 