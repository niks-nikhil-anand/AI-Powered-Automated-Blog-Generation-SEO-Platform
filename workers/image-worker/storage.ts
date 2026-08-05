import crypto from "crypto";
import https from "https";
import { env, isS3Configured } from "../shared/env";
import { UploadedImage } from "./types";

function hmac(key: Buffer | string, value: string) {
  return crypto.createHmac("sha256", key).update(value).digest();
}

function sha256(value: Buffer | string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function amzDate(date = new Date()) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function dateStamp(amz: string) {
  return amz.slice(0, 8);
}

function signingKey(secret: string, date: string, region: string, service: string) {
  const kDate = hmac(`AWS4${secret}`, date);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}

function encodeKey(key: string) {
  return key.split("/").map(encodeURIComponent).join("/");
}

function publicUrl(bucket: string, region: string, key: string) {
  const base = env.AWS_S3_PUBLIC_BASE_URL;
  if (base) return `${base.replace(/\/$/, "")}/${encodeKey(key)}`;
  return `https://${bucket}.s3.${region}.amazonaws.com/${encodeKey(key)}`;
}

export async function uploadToS3(key: string, body: Buffer, contentType: string): Promise<UploadedImage> {
  if (!isS3Configured || !env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY || !env.AWS_S3_BUCKET) {
    throw new Error("AWS S3 is not configured. Set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and AWS_S3_BUCKET.");
  }

  const region = env.AWS_REGION;
  const bucket = env.AWS_S3_BUCKET;
  const host = `${bucket}.s3.${region}.amazonaws.com`;
  const path = `/${encodeKey(key)}`;
  const now = amzDate();
  const stamp = dateStamp(now);
  const payloadHash = sha256(body);
  const tokenHeader = env.AWS_SESSION_TOKEN ? `x-amz-security-token:${env.AWS_SESSION_TOKEN}\n` : "";
  const signedHeaders = env.AWS_SESSION_TOKEN
    ? "content-type;host;x-amz-content-sha256;x-amz-date;x-amz-security-token"
    : "content-type;host;x-amz-content-sha256;x-amz-date";
  const canonicalHeaders = [
    `content-type:${contentType}`,
    `host:${host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${now}`,
    tokenHeader.trimEnd(),
  ]
    .filter(Boolean)
    .join("\n");
  const canonicalRequest = ["PUT", path, "", `${canonicalHeaders}\n`, signedHeaders, payloadHash].join("\n");
  const scope = `${stamp}/${region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", now, scope, sha256(canonicalRequest)].join("\n");
  const signature = crypto
    .createHmac("sha256", signingKey(env.AWS_SECRET_ACCESS_KEY, stamp, region, "s3"))
    .update(stringToSign)
    .digest("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${env.AWS_ACCESS_KEY_ID}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  await new Promise<void>((resolve, reject) => {
    const req = https.request(
      {
        method: "PUT",
        host,
        path,
        headers: {
          Authorization: authorization,
          "Content-Type": contentType,
          "Content-Length": body.length,
          "x-amz-content-sha256": payloadHash,
          "x-amz-date": now,
          ...(env.AWS_SESSION_TOKEN ? { "x-amz-security-token": env.AWS_SESSION_TOKEN } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve();
          } else {
            reject(new Error(`S3 upload failed (${res.statusCode}): ${Buffer.concat(chunks).toString("utf8")}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.end(body);
  });

  return {
    bucket,
    key,
    publicUrl: publicUrl(bucket, region, key),
    size: body.length,
  };
}

export async function deleteFromS3(key: string): Promise<void> {
  if (!isS3Configured || !env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY || !env.AWS_S3_BUCKET) {
    return; // Silently skip if S3 not configured
  }

  const region = env.AWS_REGION;
  const bucket = env.AWS_S3_BUCKET;
  const host = `${bucket}.s3.${region}.amazonaws.com`;
  const path = `/${encodeKey(key)}`;
  const now = amzDate();
  const stamp = dateStamp(now);
  const payloadHash = sha256("");
  const tokenHeader = env.AWS_SESSION_TOKEN ? `x-amz-security-token:${env.AWS_SESSION_TOKEN}\n` : "";
  const signedHeaders = env.AWS_SESSION_TOKEN
    ? "host;x-amz-content-sha256;x-amz-date;x-amz-security-token"
    : "host;x-amz-content-sha256;x-amz-date";
  const canonicalHeaders = [
    `host:${host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${now}`,
    tokenHeader.trimEnd(),
  ]
    .filter(Boolean)
    .join("\n");
  const canonicalRequest = ["DELETE", path, "", `${canonicalHeaders}\n`, signedHeaders, payloadHash].join("\n");
  const scope = `${stamp}/${region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", now, scope, sha256(canonicalRequest)].join("\n");
  const signature = crypto
    .createHmac("sha256", signingKey(env.AWS_SECRET_ACCESS_KEY, stamp, region, "s3"))
    .update(stringToSign)
    .digest("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${env.AWS_ACCESS_KEY_ID}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  await new Promise<void>((resolve, reject) => {
    const req = https.request(
      {
        method: "DELETE",
        host,
        path,
        headers: {
          Authorization: authorization,
          "x-amz-content-sha256": payloadHash,
          "x-amz-date": now,
          ...(env.AWS_SESSION_TOKEN && { "x-amz-security-token": env.AWS_SESSION_TOKEN }),
        },
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve();
        } else {
          reject(new Error(`S3 delete failed: ${res.statusCode}`));
        }
      }
    );
    req.on("error", reject);
    req.end();
  });
}
