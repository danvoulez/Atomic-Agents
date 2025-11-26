/**
 * Untrusted Brain Contract
 *
 * The fundamental rules that govern all agents in the system.
 * This contract is included in every agent's system prompt.
 */
export interface ContractContext {
    traceId: string;
    mode: "mechanic" | "genius";
    stepCap: number;
    tokenCap: number;
    timeLimitSeconds: number;
}
/**
 * Build the Untrusted Brain Contract section of the system prompt
 */
export declare function buildUntrustedBrainContract(ctx: ContractContext): string;
/**
 * Short version for context-limited situations
 */
export declare const untrustedBrainContractShort: string;
