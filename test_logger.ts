import { debugLogger } from "./src/shared/utils/debugLogger.ts";

console.log("Starting test...");
debugLogger.writeInfo(`Test log entry at ${new Date().toISOString()}`);
debugLogger.info(`Test info entry at ${new Date().toISOString()}`);
console.log("Test finished.");
// Process might exit before stream flushes
