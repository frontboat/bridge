#!/usr/bin/env bun
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Standalone Resource Balance Checker for Eternum
 * 
 * Usage:
 * bun run resource-checker.ts
 * 
 * Or with specific entity ID:
 * bun run resource-checker.ts 12345
 */

// Constants
const RESOURCE_PRECISION_MULTIPLIER = 1_000_000_000; // 1e9

// API Query Function
async function queryEternumAPI(query: string): Promise<any> {
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
function hexToResourceValue(hex: string | null | undefined): number {
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

// Helper function to convert hex to ASCII
function hexToAscii(hexStr: string): string {
  if (!hexStr || typeof hexStr !== "string" || !hexStr.startsWith("0x")) return "N/A";

  let str = "";
  for (let i = 2; i < hexStr.length; i += 2) {
    const charCode = Number.parseInt(hexStr.substr(i, 2), 16);
    if (charCode === 0) continue;
    if (isNaN(charCode)) continue;
    str += String.fromCharCode(charCode);
  }

  return str.replace(/\0/g, "").trim() || "N/A";
}

// Get all resource balances for one entity
async function getAllResourceBalances(entityId: number): Promise<Record<string, number>> {
  const query = `
    SELECT 
      STONE_BALANCE,
      COAL_BALANCE,
      WOOD_BALANCE,
      COPPER_BALANCE,
      IRONWOOD_BALANCE,
      OBSIDIAN_BALANCE,
      GOLD_BALANCE,
      SILVER_BALANCE,
      MITHRAL_BALANCE,
      ALCHEMICAL_SILVER_BALANCE,
      COLD_IRON_BALANCE,
      DEEP_CRYSTAL_BALANCE,
      RUBY_BALANCE,
      DIAMONDS_BALANCE,
      SAPPHIRE_BALANCE,
      HARTWOOD_BALANCE,
      IGNIUM_BALANCE,
      TWILIGHT_QUARTZ_BALANCE,
      TRUE_ICE_BALANCE,
      ADAMANTINE_BALANCE,
      ETHEREAL_SILICA_BALANCE,
      DRAGONHIDE_BALANCE,
      LABOR_BALANCE,
      EARTHEN_SHARD_BALANCE,
      DONKEY_BALANCE,
      WHEAT_BALANCE,
      FISH_BALANCE,
      LORDS_BALANCE,
      KNIGHT_T1_BALANCE,
      KNIGHT_T2_BALANCE,
      KNIGHT_T3_BALANCE,
      CROSSBOWMAN_T1_BALANCE,
      CROSSBOWMAN_T2_BALANCE,
      CROSSBOWMAN_T3_BALANCE,
      PALADIN_T1_BALANCE,
      PALADIN_T2_BALANCE,
      PALADIN_T3_BALANCE
    FROM "s1_eternum-Resource"
    WHERE entity_id = ${entityId}
  `;
  
  try {
    const result = await queryEternumAPI(query);
    if (result && result.length > 0) {
      const item = result[0];
      const balances: Record<string, number> = {};
      
      // Convert all hex values to actual resource amounts
      const resourceTypes = [
        'STONE', 'COAL', 'WOOD', 'COPPER', 'IRONWOOD', 'OBSIDIAN',
        'GOLD', 'SILVER', 'MITHRAL', 'ALCHEMICAL_SILVER', 'COLD_IRON',
        'DEEP_CRYSTAL', 'RUBY', 'DIAMONDS', 'SAPPHIRE', 'HARTWOOD',
        'IGNIUM', 'TWILIGHT_QUARTZ', 'TRUE_ICE', 'ADAMANTINE',
        'ETHEREAL_SILICA', 'DRAGONHIDE', 'LABOR', 'EARTHEN_SHARD',
        'DONKEY', 'WHEAT', 'FISH', 'LORDS',
        'KNIGHT_T1', 'KNIGHT_T2', 'KNIGHT_T3',
        'CROSSBOWMAN_T1', 'CROSSBOWMAN_T2', 'CROSSBOWMAN_T3',
        'PALADIN_T1', 'PALADIN_T2', 'PALADIN_T3'
      ];
      
      resourceTypes.forEach(resourceType => {
        const balanceKey = `${resourceType}_BALANCE`;
        balances[resourceType] = hexToResourceValue(item[balanceKey]);
      });
      
      return balances;
    }
    return {};
  } catch (error) {
    console.error(`Error fetching all resource balances for entity ${entityId}:`, error);
    return {};
  }
}

// Get entity info (name, owner, etc.)
async function getEntityInfo(entityId: number): Promise<{
  entity_id: number;
  owner_name?: string;
  realm_name?: string;
  owner_address?: string;
  x?: number;
  y?: number;
  level?: number;
}> {
  const query = `
    SELECT 
      s.entity_id,
      s.owner,
      s."base.coord_x" as x,
      s."base.coord_y" as y,
      s."base.level" as level,
      an.name as owner_name,
      srd.realm_name
    FROM "s1_eternum-Structure" s
    LEFT JOIN "s1_eternum-AddressName" an ON s.owner = an.address
    LEFT JOIN "s1_eternum-SettleRealmData" srd ON s.entity_id = srd.entity_id
    WHERE s.entity_id = ${entityId}
  `;
  
  try {
    const result = await queryEternumAPI(query);
    if (result && result.length > 0) {
      const item = result[0];
      return {
        entity_id: Number(item.entity_id || 0),
        owner_name: item.owner_name ? hexToAscii(item.owner_name) : undefined,
        realm_name: item.realm_name ? hexToAscii(item.realm_name) : undefined,
        owner_address: item.owner || undefined,
        x: Number(item.x || 0),
        y: Number(item.y || 0),
        level: Number(item.level || 0),
      };
    }
    return { entity_id: entityId };
  } catch (error) {
    console.error(`Error fetching entity info for ${entityId}:`, error);
    return { entity_id: entityId };
  }
}

// Format number with commas
function formatNumber(num: number): string {
  return num.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

// Get wealth analysis
function analyzeWealth(balances: Record<string, number>): {
  totalRawMaterials: number;
  totalRareResources: number;
  totalMilitary: number;
  totalLords: number;
  grandTotal: number;
} {
  const rawMaterials = ['STONE', 'COAL', 'WOOD', 'COPPER', 'LABOR', 'WHEAT', 'FISH', 'DONKEY'];
  const rareResources = [
    'IRONWOOD', 'OBSIDIAN', 'GOLD', 'SILVER', 'MITHRAL', 'ALCHEMICAL_SILVER',
    'COLD_IRON', 'DEEP_CRYSTAL', 'RUBY', 'DIAMONDS', 'SAPPHIRE', 'HARTWOOD',
    'IGNIUM', 'TWILIGHT_QUARTZ', 'TRUE_ICE', 'ADAMANTINE', 'ETHEREAL_SILICA',
    'DRAGONHIDE', 'EARTHEN_SHARD'
  ];
  const military = [
    'KNIGHT_T1', 'KNIGHT_T2', 'KNIGHT_T3',
    'CROSSBOWMAN_T1', 'CROSSBOWMAN_T2', 'CROSSBOWMAN_T3',
    'PALADIN_T1', 'PALADIN_T2', 'PALADIN_T3'
  ];
  
  const totalRawMaterials = rawMaterials.reduce((sum, resource) => sum + (balances[resource] || 0), 0);
  const totalRareResources = rareResources.reduce((sum, resource) => sum + (balances[resource] || 0), 0);
  const totalMilitary = military.reduce((sum, resource) => sum + (balances[resource] || 0), 0);
  const totalLords = balances['LORDS'] || 0;
  
  return {
    totalRawMaterials,
    totalRareResources,
    totalMilitary,
    totalLords,
    grandTotal: totalRawMaterials + totalRareResources + totalMilitary + totalLords,
  };
}

// Main function
async function main() {
  console.log("🏰 Eternum Resource Balance Checker\n");
  
  // Get entity ID from command line args or use default
  const entityId = process.argv[2] ? parseInt(process.argv[2]) : 1; // Default to entity 1
  
  console.log(`📊 Checking resources for Entity ID: ${entityId}\n`);
  
  try {
    // Get entity info and resource balances
    const [entityInfo, balances] = await Promise.all([
      getEntityInfo(entityId),
      getAllResourceBalances(entityId)
    ]);
    
    // Display entity information
    console.log("🏛️  ENTITY INFORMATION");
    console.log("═".repeat(50));
    console.log(`Entity ID: ${entityInfo.entity_id}`);
    if (entityInfo.realm_name && entityInfo.realm_name !== "N/A") {
      console.log(`Realm Name: ${entityInfo.realm_name}`);
    }
    if (entityInfo.owner_name && entityInfo.owner_name !== "N/A") {
      console.log(`Owner: ${entityInfo.owner_name}`);
    }
    if (entityInfo.owner_address) {
      console.log(`Owner Address: ${entityInfo.owner_address}`);
    }
    if (entityInfo.x !== undefined && entityInfo.y !== undefined) {
      console.log(`Coordinates: (${entityInfo.x}, ${entityInfo.y})`);
    }
    if (entityInfo.level) {
      console.log(`Level: ${entityInfo.level}`);
    }
    console.log();
    
    // Check if entity has any resources
    const hasResources = Object.values(balances).some(balance => balance > 0);
    
    if (!hasResources) {
      console.log("❌ No resources found for this entity.");
      console.log("   This could mean:");
      console.log("   • Entity doesn't exist");
      console.log("   • Entity has no resources");
      console.log("   • Entity ID is incorrect");
      return;
    }
    
    // Analyze wealth
    const wealth = analyzeWealth(balances);
    
    // Display wealth summary
    console.log("💰 WEALTH SUMMARY");
    console.log("═".repeat(50));
    console.log(`Raw Materials: ${formatNumber(wealth.totalRawMaterials)}`);
    console.log(`Rare Resources: ${formatNumber(wealth.totalRareResources)}`);
    console.log(`Military Units: ${formatNumber(wealth.totalMilitary)}`);
    console.log(`Lords Currency: ${formatNumber(wealth.totalLords)}`);
    console.log("─".repeat(30));
    console.log(`TOTAL VALUE: ${formatNumber(wealth.grandTotal)}`);
    console.log();
    
    // Display detailed resources (only non-zero balances)
    console.log("📦 DETAILED RESOURCE BREAKDOWN");
    console.log("═".repeat(50));
    
    const categories = {
      "Raw Materials": ['STONE', 'COAL', 'WOOD', 'COPPER', 'LABOR', 'WHEAT', 'FISH', 'DONKEY'],
      "Rare Resources": [
        'IRONWOOD', 'OBSIDIAN', 'GOLD', 'SILVER', 'MITHRAL', 'ALCHEMICAL_SILVER',
        'COLD_IRON', 'DEEP_CRYSTAL', 'RUBY', 'DIAMONDS', 'SAPPHIRE', 'HARTWOOD',
        'IGNIUM', 'TWILIGHT_QUARTZ', 'TRUE_ICE', 'ADAMANTINE', 'ETHEREAL_SILICA',
        'DRAGONHIDE', 'EARTHEN_SHARD'
      ],
      "Military Units": [
        'KNIGHT_T1', 'KNIGHT_T2', 'KNIGHT_T3',
        'CROSSBOWMAN_T1', 'CROSSBOWMAN_T2', 'CROSSBOWMAN_T3',
        'PALADIN_T1', 'PALADIN_T2', 'PALADIN_T3'
      ],
      "Currency": ['LORDS']
    };
    
    for (const [categoryName, resources] of Object.entries(categories)) {
      const categoryResources = resources.filter(resource => (balances[resource] || 0) > 0);
      
      if (categoryResources.length > 0) {
        console.log(`\n${categoryName}:`);
        categoryResources.forEach(resource => {
          const balance = balances[resource];
          console.log(`  ${resource.replace(/_/g, ' ')}: ${formatNumber(balance)}`);
        });
      }
    }
    
    console.log("\n✅ Resource check completed!");
    
  } catch (error) {
    console.error("❌ Error:", error);
  }
}

// Run the script
if (require.main === module) {
  main().catch(console.error);
}