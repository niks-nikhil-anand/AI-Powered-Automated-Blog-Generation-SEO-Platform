"use client";

import React, { useState } from "react";

export default function SettingsPage() {
  const [dailyLimit, setDailyLimit] = useState(14);
  const [cron, setCron] = useState("0 */2 * * *");
  const [autoPublish, setAutoPublish] = useState(true);
  const [slackNotif, setSlackNotif] = useState(true);
  const [autoRetry, setAutoRetry] = useState(false);
  const [gcsBucket, setGcsBucket] = useState("devkit-market-media");
  const [cdnUrl, setCdnUrl] = useState("https://cdn.devkit.market");
  const [redisUrl, setRedisUrl] = useState("redis://cache-prod-01:6379");
  const [redisTested, setRedisTested] = useState(false);

  const modelRows = [
    { stage: "Research", model: "gemini-2.5-flash", cost: "$0.002" },
    { stage: "Planning", model: "gemini-2.5-flash", cost: "$0.004" },
    { stage: "Outline", model: "gemini-2.5-pro", cost: "$0.018" },
    { stage: "Writing", model: "gemini-2.5-pro", cost: "$0.180" },
    { stage: "Image", model: "imagen-4.0", cost: "$0.040" },
    { stage: "Quality QA", model: "gemini-2.5-pro", cost: "$0.022" },
    { stage: "Publisher", model: "system-auto", cost: "$0.000" },
  ];

  return (
    <div className="flex flex-col gap-[13px] max-w-[1080px]">
      {/* Header */}
      <div>
        <h1 className="margin-0 text-[19px] font-extrabold tracking-tight text-[var(--fg)]">
          Settings & AI Models
        </h1>
        <p className="margin-0 text-[12px] text-[var(--mut)] mt-[3px]">
          Pipeline configuration · last saved 2 hours ago by Aarav
        </p>
      </div>

      {/* Settings Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-[12px] items-start">
        {/* General Settings */}
        <div className="bg-[var(--card)] border border-[var(--bd)] rounded-[12px] shadow-[var(--shadow)] overflow-hidden">
          <div className="p-[12px_14px] border-b border-[var(--bd)] text-[13px] font-bold text-[var(--fg)]">
            General Configuration
          </div>
          <div className="p-[14px] flex flex-col gap-[16px]">
            <div>
              <div className="flex items-center justify-between mb-[8px]">
                <label
                  htmlFor="input-daily-limit"
                  className="text-[12px] font-semibold text-[var(--fg2)]"
                >
                  Daily blog generation limit
                </label>
                <span className="font-mono font-bold text-[13px] p-[2px_8px] rounded-[7px] bg-[var(--tint)] text-[var(--indigo)]">
                  {dailyLimit}/day
                </span>
              </div>
              <input
                id="input-daily-limit"
                type="range"
                min="1"
                max="20"
                aria-label="Daily blog generation limit"
                value={dailyLimit}
                onChange={(e) => setDailyLimit(Number(e.target.value))}
                className="w-full accent-[var(--indigo)] cursor-pointer"
              />
              <div className="flex justify-between font-mono text-[9.5px] text-[var(--faint)] mt-[3px]">
                <span>1</span>
                <span>10</span>
                <span>20</span>
              </div>
            </div>

            <div>
              <label
                htmlFor="input-cron"
                className="text-[12px] font-semibold text-[var(--fg2)] block mb-[6px]"
              >
                Cron Schedule Expression
              </label>
              <input
                id="input-cron"
                aria-label="Cron schedule"
                value={cron}
                onChange={(e) => setCron(e.target.value)}
                className="w-full h-[32px] px-[10px] rounded-[8px] border border-[var(--bd)] bg-[var(--card2)] text-[var(--fg)] font-mono font-semibold text-[12px] outline-none"
              />
              <div className="text-[10.5px] text-[var(--faint)] mt-[5px]">
                Runs every 2 hours · next run 14:00 IST
              </div>
            </div>

            {/* Toggles */}
            <div className="flex flex-col gap-[12px] pt-[6px]">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[12px] font-semibold text-[var(--fg)]">
                    Auto-publish on QA Pass
                  </div>
                  <div className="text-[10.5px] text-[var(--mut)]">
                    Automatically publish articles with score ≥ 90
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setAutoPublish(!autoPublish)}
                  className={`w-[38px] h-[21px] rounded-full relative transition-colors ${
                    autoPublish ? "bg-[var(--indigo)]" : "bg-[var(--bd2)]"
                  }`}
                >
                  <span
                    className={`absolute top-[2px] w-[17px] h-[17px] rounded-full bg-white transition-transform ${
                      autoPublish ? "left-[19px]" : "left-[2px]"
                    }`}
                  />
                </button>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[12px] font-semibold text-[var(--fg)]">
                    Slack / Email Alerts
                  </div>
                  <div className="text-[10.5px] text-[var(--mut)]">
                    Send notifications on QA failures or worker errors
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSlackNotif(!slackNotif)}
                  className={`w-[38px] h-[21px] rounded-full relative transition-colors ${
                    slackNotif ? "bg-[var(--indigo)]" : "bg-[var(--bd2)]"
                  }`}
                >
                  <span
                    className={`absolute top-[2px] w-[17px] h-[17px] rounded-full bg-white transition-transform ${
                      slackNotif ? "left-[19px]" : "left-[2px]"
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* AI Model Per Pipeline Stage */}
        <div className="bg-[var(--card)] border border-[var(--bd)] rounded-[12px] shadow-[var(--shadow)] overflow-hidden">
          <div className="p-[12px_14px] border-b border-[var(--bd)] text-[13px] font-bold text-[var(--fg)]">
            AI Model Per Pipeline Stage
          </div>
          <div className="p-[8px_14px_14px]">
            {modelRows.map((m, idx) => (
              <div
                key={idx}
                className="flex items-center gap-[10px] py-[8px] border-b border-[var(--bd)] last:border-0"
              >
                <span className="w-[88px] flex-none text-[11.5px] font-semibold text-[var(--fg)]">
                  {m.stage}
                </span>
                <select
                  aria-label="Select model for stage"
                  defaultValue={m.model}
                  className="flex-1 h-[29px] px-[8px] rounded-[8px] border border-[var(--bd)] bg-[var(--card2)] text-[var(--fg)] font-mono font-semibold text-[11.5px] outline-none"
                >
                  <option value="gemini-2.5-pro">gemini-2.5-pro</option>
                  <option value="gemini-2.5-flash">gemini-2.5-flash</option>
                  <option value="imagen-4.0">imagen-4.0</option>
                  <option value="system-auto">system-auto</option>
                </select>
                <span className="flex-none w-[58px] text-right font-mono text-[10.5px] text-[var(--mut)]">
                  {m.cost}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Cloud & Storage Config (Full Width) */}
        <div className="bg-[var(--card)] border border-[var(--bd)] rounded-[12px] shadow-[var(--shadow)] overflow-hidden md:col-span-2">
          <div className="p-[12px_14px] border-b border-[var(--bd)] text-[13px] font-bold text-[var(--fg)]">
            Cloud Infrastructure & Storage Connection
          </div>
          <div className="p-[14px] grid grid-cols-1 md:grid-cols-3 gap-[12px]">
            <div>
              <label
                htmlFor="input-gcs"
                className="text-[11.5px] font-semibold text-[var(--fg2)] block mb-[6px]"
              >
                GCS Bucket Name
              </label>
              <input
                id="input-gcs"
                aria-label="GCS bucket name"
                value={gcsBucket}
                onChange={(e) => setGcsBucket(e.target.value)}
                className="w-full h-[31px] px-[10px] rounded-[8px] border border-[var(--bd)] bg-[var(--card2)] text-[var(--fg)] font-mono text-[11.5px] outline-none"
              />
            </div>
            <div>
              <label
                htmlFor="input-cdn"
                className="text-[11.5px] font-semibold text-[var(--fg2)] block mb-[6px]"
              >
                CDN Base URL
              </label>
              <input
                id="input-cdn"
                aria-label="CDN base URL"
                value={cdnUrl}
                onChange={(e) => setCdnUrl(e.target.value)}
                className="w-full h-[31px] px-[10px] rounded-[8px] border border-[var(--bd)] bg-[var(--card2)] text-[var(--fg)] font-mono text-[11.5px] outline-none"
              />
            </div>
            <div>
              <label
                htmlFor="input-redis"
                className="text-[11.5px] font-semibold text-[var(--fg2)] block mb-[6px]"
              >
                Redis URL (BullMQ Queue)
              </label>
              <div className="flex gap-[7px]">
                <input
                  id="input-redis"
                  aria-label="Redis connection URL"
                  value={redisUrl}
                  onChange={(e) => setRedisUrl(e.target.value)}
                  className="flex-1 h-[31px] px-[10px] rounded-[8px] border border-[var(--bd)] bg-[var(--card2)] text-[var(--fg)] font-mono text-[11.5px] outline-none"
                />
                <button
                  id="btn-test-redis"
                  type="button"
                  aria-label="Test Redis connection"
                  onClick={() => {
                    setRedisTested(true);
                    setTimeout(() => alert("Redis Connection Successful! (PONG 0.4ms)"), 200);
                  }}
                  className="h-[31px] px-[11px] rounded-[8px] border border-[var(--bd)] bg-[var(--card)] text-[var(--fg2)] text-[11.5px] font-semibold hover:border-[var(--emerald)] hover:text-[var(--emerald)] transition-colors whitespace-nowrap"
                >
                  {redisTested ? "Connected ✓" : "Test Connection"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Save / Discard Bar */}
      <div className="flex gap-[8px] justify-end mt-[6px]">
        <button
          id="btn-settings-cancel"
          type="button"
          aria-label="Discard changes"
          onClick={() => alert("Discarded unsaved configuration changes.")}
          className="h-[32px] px-[14px] rounded-[8px] border border-[var(--bd)] bg-[var(--card)] text-[var(--fg2)] text-[12px] font-semibold hover:border-[var(--bd2)]"
        >
          Discard
        </button>
        <button
          id="btn-settings-save"
          type="button"
          aria-label="Save configuration"
          onClick={() => alert("Pipeline configuration saved successfully!")}
          className="h-[32px] px-[16px] rounded-[8px] border border-transparent bg-[var(--indigo)] text-white text-[12px] font-bold hover:bg-[#4f46e5] shadow-sm transition-colors"
        >
          Save configuration
        </button>
      </div>
    </div>
  );
}
