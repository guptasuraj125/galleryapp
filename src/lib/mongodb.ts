import { execFile } from "node:child_process";
import { promisify } from "node:util";
import mongoose from "mongoose";
import { MongoConnectionError, toMongoConnectionError } from "./mongodb-errors";

interface MongooseCache {
  connection: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
}

interface AtlasSrvRecord {
  name: string;
  port: number;
}

interface WindowsDnsResponse {
  srv?: AtlasSrvRecord | AtlasSrvRecord[];
  txt?: string | string[];
}

declare global {
  var mongooseCache: MongooseCache | undefined;
}

const cached = globalThis.mongooseCache ?? {
  connection: null,
  promise: null,
};

globalThis.mongooseCache = cached;

const execFileAsync = promisify(execFile);

const WINDOWS_ATLAS_DNS_SCRIPT = [
  "$ErrorActionPreference='Stop'",
  "$domain=$env:GHUMI_ATLAS_SRV_DOMAIN",
  "if ($domain -notmatch '^[a-z0-9.-]+$') { throw 'Invalid Atlas DNS name' }",
  "$srv=@(Resolve-DnsName -Name ('_mongodb._tcp.'+$domain) -Type SRV -DnsOnly | Where-Object {$_.Type -eq 'SRV'} | ForEach-Object {[pscustomobject]@{name=$_.NameTarget.TrimEnd('.').ToLowerInvariant();port=[int]$_.Port}})",
  "$txt=@(Resolve-DnsName -Name $domain -Type TXT -DnsOnly -ErrorAction SilentlyContinue | Where-Object {$_.Type -eq 'TXT'} | ForEach-Object {$_.Strings -join ''})",
  "[pscustomobject]@{srv=$srv;txt=$txt} | ConvertTo-Json -Compress -Depth 4",
].join("; ");

function normalizeArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

async function resolveAtlasRecordsWithWindowsDns(domain: string): Promise<WindowsDnsResponse> {
  const systemRoot = process.env.SystemRoot;
  const path = process.env.PATH;
  if (!systemRoot || !path) {
    throw new Error("Windows DNS lookup requires the system PATH and SystemRoot.");
  }

  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", WINDOWS_ATLAS_DNS_SCRIPT],
    {
      windowsHide: true,
      timeout: 10_000,
      maxBuffer: 32 * 1024,
      env: {
        GHUMI_ATLAS_SRV_DOMAIN: domain,
        NODE_ENV: process.env.NODE_ENV ?? "development",
        PATH: path,
        SystemRoot: systemRoot,
      },
    },
  );

  return JSON.parse(stdout.trim()) as WindowsDnsResponse;
}

async function resolveWindowsAtlasUri(uri: string): Promise<string> {
  const parsed = new URL(uri);
  const domain = parsed.hostname.toLowerCase();
  if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(domain)) {
    throw new Error("MONGODB_URI must contain a valid Atlas SRV hostname.");
  }

  const response = await resolveAtlasRecordsWithWindowsDns(domain);
  const records = normalizeArray(response.srv);
  const parentDomain = domain.split(".").slice(1).join(".");
  const hosts = records
    .filter(
      (record) =>
        record &&
        Number.isInteger(record.port) &&
        record.port > 0 &&
        record.port <= 65535 &&
        (record.name === parentDomain || record.name.endsWith(`.${parentDomain}`)),
    )
    .map((record) => `${record.name}:${record.port}`);

  if (hosts.length === 0) {
    throw new Error(`Windows DNS returned no valid MongoDB SRV hosts for ${domain}.`);
  }

  const options = new URLSearchParams();
  for (const txtRecord of normalizeArray(response.txt)) {
    for (const [key, value] of new URLSearchParams(txtRecord)) {
      options.set(key, value);
    }
  }
  for (const [key, value] of parsed.searchParams) {
    options.set(key, value);
  }
  options.set("tls", "true");

  const credentials = parsed.username
    ? `${parsed.username}${parsed.password ? `:${parsed.password}` : ""}@`
    : "";
  const databasePath = parsed.pathname === "/" ? "" : parsed.pathname;
  const query = options.toString();
  return `mongodb://${credentials}${hosts.join(",")}${databasePath}${query ? `?${query}` : ""}`;
}

export async function connectToDatabase(): Promise<typeof mongoose> {
  if (cached.connection) {
    return cached.connection;
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is not set. Add it to your environment before connecting.");
  }

  if (!cached.promise) {
    cached.promise = (async () => {
      let connectionUri = uri;
      if (process.platform === "win32" && uri.startsWith("mongodb+srv://")) {
        try {
          connectionUri = await resolveWindowsAtlasUri(uri);
        } catch (error) {
          throw new MongoConnectionError("dns", error);
        }
      }
      return mongoose.connect(connectionUri, { bufferCommands: false });
    })();
  }

  try {
    cached.connection = await cached.promise;
  } catch (error) {
    cached.promise = null;
    throw toMongoConnectionError(error) ?? error;
  }

  return cached.connection;
}
