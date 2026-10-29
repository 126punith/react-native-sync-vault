import { defineContractSuite, memoryHarness } from '../src/testing/contract';

defineContractSuite('MemorySyncVault', () => memoryHarness(), { describe, it, expect, beforeEach, afterEach });
