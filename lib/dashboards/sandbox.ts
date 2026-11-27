import { getQuickJS, newAsyncContext } from "quickjs-emscripten";
import { DashboardError } from "./errors";

export type ScriptTools = Record<string, (args: Record<string, unknown>) => Promise<unknown>>;
const MAX_RESULT_BYTES = 2 * 1024 * 1024;

/** Compile inside QuickJS, never Node's eval, Function, or vm. */
export async function checkScript(source: string): Promise<void> {
  const quickjs = await getQuickJS();
  const vm = quickjs.newContext();
  vm.runtime.setMemoryLimit(32 * 1024 * 1024);
  vm.runtime.setInterruptHandler(() => Date.now() > deadline);
  const deadline = Date.now() + 1_000;
  try {
    const result = vm.evalCode(`(function(args, tools) { "use strict";\n${source}\n})`);
    if (result.error) {
      result.error.dispose();
      throw new DashboardError("Invalid script syntax", "invalid_script");
    }
    result.value.dispose();
  } finally { vm.dispose(); }
}

/**
 * A fresh WebAssembly VM for each run. Only JSON crosses the host bridge.
 * Tools appear synchronous inside the VM; Asyncify suspends it for real I/O.
 * There is no process, require, fetch, filesystem, network, or module loader.
 */
export async function runScript(source: string, args: Record<string, unknown>, tools: ScriptTools, {
  signal = new AbortController().signal, cpuMs = 2_000, timeoutMs = 120_000, maxCalls = 16,
}: { signal?: AbortSignal; cpuMs?: number; timeoutMs?: number; maxCalls?: number } = {}): Promise<unknown> {
  const combined = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
  combined.throwIfAborted();
  const vm = await newAsyncContext();
  let cpuDeadline = Date.now() + cpuMs;
  let calls = 0;
  vm.runtime.setMemoryLimit(32 * 1024 * 1024);
  vm.runtime.setMaxStackSize(512 * 1024);
  vm.runtime.setInterruptHandler(() => combined.aborted || Date.now() > cpuDeadline);
  const invoke = vm.newAsyncifiedFunction("callTool", async (nameHandle, argsHandle) => {
    const name = vm.getString(nameHandle);
    const input = vm.getString(argsHandle);
    const started = Date.now();
    try {
      combined.throwIfAborted();
      if (++calls > maxCalls) throw new Error("Script tool-call limit exceeded");
      if (!Object.hasOwn(tools, name)) throw new Error(`Unknown tool: ${name}`);
      const parsed: unknown = JSON.parse(input);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Tool arguments must be an object");
      const result = await abortable(tools[name](parsed as Record<string, unknown>), combined);
      const json = JSON.stringify({ result: result ?? null });
      if (Buffer.byteLength(json) > MAX_RESULT_BYTES) throw new Error("Script tool result too large");
      return vm.newString(json);
    } catch (error) {
      return vm.newString(JSON.stringify({ error: error instanceof Error ? error.message : "Tool failed" }));
    } finally {
      cpuDeadline += Date.now() - started;
    }
  });
  vm.setProp(vm.global, "__callTool", invoke);
  invoke.dispose();
  try {
    const code = `JSON.stringify((function() {
      "use strict";
      const bridge = globalThis.__callTool;
      delete globalThis.__callTool;
      const tools = Object.freeze(Object.fromEntries(${JSON.stringify(Object.keys(tools))}.map(name => [name, args => {
        const response = JSON.parse(bridge(name, JSON.stringify(args)));
        if (Object.hasOwn(response, "error")) throw new Error(response.error);
        return response.result;
      }])));
      const result = (function(args, tools) { ${source}\n})(${JSON.stringify(args)}, tools);
      if (result && typeof result.then === "function") throw new Error("Scripts must return JSON, not a Promise; tools are synchronous inside scripts");
      return result;
    })())`;
    const result = await vm.evalCodeAsync(code);
    if (result.error) {
      const detail: unknown = vm.dump(result.error);
      result.error.dispose();
      combined.throwIfAborted();
      const message = detail && typeof detail === "object" && "message" in detail ? String(detail.message) : "Script execution failed";
      throw new DashboardError(message, "script_failed", 422);
    }
    const json: unknown = vm.dump(result.value);
    result.value.dispose();
    combined.throwIfAborted();
    if (typeof json !== "string" || Buffer.byteLength(json) > MAX_RESULT_BYTES) {
      throw new DashboardError("Script must return JSON within 2 MiB", "invalid_script_result", 422);
    }
    return JSON.parse(json) as unknown;
  } finally { vm.dispose(); }
}

async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let abort: () => void = () => {};
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
    })]);
  } finally { signal.removeEventListener("abort", abort); }
}
