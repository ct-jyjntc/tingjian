"use client";
import { useEffect, useState } from "react";
import {
  Check,
  ChevronRight,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  Save,
  Settings2,
  ShieldCheck,
  Volume2,
} from "lucide-react";
import {
  aiFields,
  aiKeys,
  aiSections,
  differentOrigin,
  endpointSecrets,
  aiSaveSchema,
  type AIKey,
  type AIPatch,
  type AISection,
  type PublicAISettings,
} from "@/lib/ai-settings";
import { api, previewText, stopPreview } from "@/lib/client";

export default function AISettings({
  onSaved,
  onDirtyChange,
}: {
  onSaved: (settings: PublicAISettings, changed: AIKey[]) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [saved, setSaved] = useState<PublicAISettings | null>(null);
  const [changes, setChanges] = useState<AIPatch>({});
  const [section, setSection] = useState<AISection>("llm");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [visibleKeys, setVisibleKeys] = useState<AIKey[]>([]);
  const [reuseSecrets, setReuseSecrets] = useState<AIKey[]>([]);
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<AIKey, string>>
  >({});
  const dirty = Object.keys(changes).length > 0;
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);

  async function reload() {
    setLoading(true);
    setError("");
    setMessage("");
    try {
      setSaved(await api("ai-settings"));
      setChanges({});
      setVisibleKeys([]);
      setReuseSecrets([]);
      setFieldErrors({});
    } catch (error) {
      setError(String(error).replace(/^Error: /, ""));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void reload();
    return () => stopPreview();
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const leave = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [dirty]);

  function value(key: AIKey) {
    if (changes[key] === null) return saved?.inheritedValues[key] || "";
    return changes[key] ?? saved?.values[key] ?? "";
  }
  function configured(key: AIKey) {
    if (changes[key] === null) return Boolean(saved?.inheritedSecrets[key]);
    if (Object.hasOwn(changes, key)) return Boolean(changes[key]);
    return Boolean(saved?.secrets[key]);
  }
  function update(key: AIKey, next: string) {
    setMessage("");
    setFieldErrors((errors) => ({ ...errors, [key]: undefined }));
    setChanges((current) => {
      const result = { ...current };
      if (aiFields[key].kind === "secret" ? !next : next === saved?.values[key])
        delete result[key];
      else result[key] = next;
      return result;
    });
  }
  const reuseNeeded = saved
    ? (
        Object.entries(endpointSecrets) as [
          keyof typeof endpointSecrets,
          AIKey,
        ][]
      ).filter(
        ([base, secret]) =>
          differentOrigin(saved.values[base] || "", value(base)) &&
          !(changes[base] === null && changes[secret] === null) &&
          configured(secret) &&
          (changes[secret] === undefined || changes[secret] === null),
      )
    : [];

  async function save() {
    if (!saved) return;
    setError("");
    setMessage("");
    const payload = { revision: saved.revision, changes, reuseSecrets };
    const parsed = aiSaveSchema.safeParse(payload);
    if (!parsed.success) {
      const errors: Partial<Record<AIKey, string>> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[1] as AIKey;
        if (aiKeys.includes(key)) errors[key] = issue.message;
      }
      setFieldErrors(errors);
      const first = Object.keys(errors)[0] as AIKey | undefined;
      if (first) setSection(aiFields[first].section);
      setError("请修正标出的配置项后再保存。");
      return;
    }
    if (reuseNeeded.some(([, secret]) => !reuseSecrets.includes(secret))) {
      setError("服务地址已更换，请填写新密钥，或勾选沿用已保存密钥。");
      return;
    }
    setBusy(true);
    try {
      const next = (await api("ai-settings", parsed.data)) as PublicAISettings;
      stopPreview();
      setSaved(next);
      setChanges({});
      setVisibleKeys([]);
      setReuseSecrets([]);
      setFieldErrors({});
      setMessage("已保存到服务器，新的 AI 请求将使用此配置。");
      onSaved(next, Object.keys(changes) as AIKey[]);
    } catch (error) {
      setError(String(error).replace(/^Error: /, ""));
    } finally {
      setBusy(false);
    }
  }
  async function test(service: "llm" | "tts") {
    if (!saved || dirty) return;
    setTesting(true);
    setError("");
    setMessage("");
    try {
      if (service === "llm") {
        const result = await api("ai-settings-test", { service: "LLM" });
        setMessage(result.message);
      } else {
        const backend =
          value("TTS_BACKEND") === "mlx-audio" ? "mlx-audio" : "edge-tts";
        await previewText(
          "你好，这是听见的语音连接测试。",
          backend === "edge-tts" ? "edge-auto" : "Vivian",
          1,
          "Chinese",
          "",
          backend,
        );
        setMessage("测试音频已开始播放。");
      }
    } catch (error) {
      setError(String(error).replace(/^Error: /, ""));
    } finally {
      setTesting(false);
    }
  }
  const currentSection = aiSections.find((item) => item.id === section)!;
  const sectionKeys = aiKeys.filter((key) => aiFields[key].section === section);
  if (loading && !saved)
    return (
      <section className="panel ai-settings-loading" role="status">
        <LoaderCircle className="spinning" size={20} />
        正在读取服务器 AI 配置…
      </section>
    );
  return (
    <section className="panel ai-settings-panel" aria-label="AI 服务配置">
      <div className="ai-settings-heading">
        <div>
          <span className="eyebrow">YOUR AI, YOUR SETTINGS</span>
          <h2>
            <Settings2 size={21} />
            AI 服务配置
          </h2>
          <p>在这里连接你的模型与语音服务。</p>
        </div>
        <span className="settings-private">
          <ShieldCheck size={15} />
          密钥仅保存在服务器
        </span>
      </div>
      {!saved ? (
        <div className="error" role="alert">
          {error}
          <button onClick={() => void reload()}>重新载入配置</button>
        </div>
      ) : (
        <>
          <div className="ai-settings-layout">
            <nav className="ai-settings-nav" aria-label="AI 配置分类">
              {aiSections.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={section === item.id ? "active" : ""}
                  aria-pressed={section === item.id}
                  onClick={() => setSection(item.id)}
                >
                  <span>{item.title}</span>
                  {aiKeys.some(
                    (key) =>
                      aiFields[key].section === item.id &&
                      Object.hasOwn(changes, key),
                  ) ? (
                    <span
                      className="settings-unsaved-dot"
                      aria-label="有未保存修改"
                    />
                  ) : (
                    <ChevronRight size={14} />
                  )}
                </button>
              ))}
            </nav>
            <div className="ai-settings-body">
              <div className="section-title">
                <h3>{currentSection.title}</h3>
                <button
                  className="settings-reset"
                  disabled={busy || testing || loading}
                  onClick={() => {
                    setChanges((current) => ({
                      ...current,
                      ...Object.fromEntries(
                        sectionKeys.map((key) => [key, null]),
                      ),
                    }));
                    setMessage(
                      "此分类将恢复为服务器环境配置，点击保存后生效。",
                    );
                  }}
                >
                  恢复本组环境配置
                </button>
              </div>
              <p className="muted">{currentSection.description}</p>
              <fieldset
                disabled={busy || testing || loading}
                className="ai-settings-fields"
              >
                {sectionKeys.map((key) => {
                  const field = aiFields[key] as {
                    label: string;
                    kind: string;
                    hint?: string;
                    options?: readonly (readonly [string, string])[];
                  };
                  const secret = field.kind === "secret";
                  const source =
                    changes[key] === null
                      ? "将恢复环境配置"
                      : Object.hasOwn(changes, key)
                        ? "待保存"
                        : saved.overridden.includes(key)
                          ? "网页配置"
                          : "服务器环境 / 默认";
                  return (
                    <div
                      key={key}
                      className={`ai-setting-field ${fieldErrors[key] ? "invalid" : ""}`}
                    >
                      <div className="setting-label">
                        <label htmlFor={`ai-${key}`}>
                          {secret && <KeyRound size={13} />}
                          {field.label}
                        </label>
                        <small>{source}</small>
                      </div>
                      {field.options ? (
                        <select
                          id={`ai-${key}`}
                          value={value(key)}
                          onChange={(event) => update(key, event.target.value)}
                        >
                          {field.options.map(([v, title]) => (
                            <option key={v} value={v}>
                              {title}
                            </option>
                          ))}
                        </select>
                      ) : secret ? (
                        <>
                          <div className="secret-input">
                            <input
                              id={`ai-${key}`}
                              type={
                                visibleKeys.includes(key) ? "text" : "password"
                              }
                              autoComplete="new-password"
                              spellCheck={false}
                              value={
                                typeof changes[key] === "string"
                                  ? changes[key]
                                  : ""
                              }
                              onChange={(event) =>
                                update(key, event.target.value)
                              }
                              placeholder={
                                configured(key)
                                  ? "已配置 · 留空保持现有密钥"
                                  : changes[key] === ""
                                    ? "将清除 · 点击保存后生效"
                                    : "尚未配置 · 输入密钥"
                              }
                            />
                            <button
                              type="button"
                              aria-label={
                                visibleKeys.includes(key)
                                  ? `隐藏新输入的${field.label}`
                                  : `显示新输入的${field.label}`
                              }
                              onClick={() =>
                                setVisibleKeys((keys) =>
                                  keys.includes(key)
                                    ? keys.filter((item) => item !== key)
                                    : [...keys, key],
                                )
                              }
                            >
                              {visibleKeys.includes(key) ? (
                                <EyeOff size={17} />
                              ) : (
                                <Eye size={17} />
                              )}
                            </button>
                          </div>
                          <div className="secret-meta">
                            <span>
                              {configured(key) ? (
                                <>
                                  <Check size={12} />
                                  已配置
                                </>
                              ) : (
                                "未配置"
                              )}
                            </span>
                            <label className="check">
                              <input
                                type="checkbox"
                                checked={changes[key] === ""}
                                onChange={(event) =>
                                  setChanges((current) => {
                                    const next = { ...current };
                                    if (event.target.checked) next[key] = "";
                                    else delete next[key];
                                    return next;
                                  })
                                }
                              />
                              清除已保存密钥
                            </label>
                          </div>
                        </>
                      ) : (
                        <input
                          id={`ai-${key}`}
                          type={field.kind === "url" ? "url" : "text"}
                          autoComplete="off"
                          spellCheck={false}
                          value={value(key)}
                          onChange={(event) => update(key, event.target.value)}
                        />
                      )}
                      {field.hint && (
                        <p className="setting-hint">{field.hint}</p>
                      )}
                      {fieldErrors[key] && (
                        <p className="field-error" role="alert">
                          {fieldErrors[key]}
                        </p>
                      )}
                    </div>
                  );
                })}
              </fieldset>
              {section === "llm" && (
                <button
                  disabled={dirty || busy || testing || loading}
                  onClick={() => void test("llm")}
                >
                  {testing ? (
                    <LoaderCircle className="spinning" size={15} />
                  ) : (
                    <Check size={15} />
                  )}
                  测试已保存模型
                </button>
              )}
              {section === "tts" && (
                <div className="row">
                  <button
                    disabled={dirty || busy || testing || loading}
                    onClick={() => void test("tts")}
                  >
                    <Volume2 size={16} />
                    {testing ? "正在生成测试语音…" : "试听已保存服务"}
                  </button>
                  <button onClick={stopPreview}>停止试听</button>
                </div>
              )}
              {(section === "llm" || section === "tts") && (
                <p className="setting-hint">
                  测试会实际调用已保存的服务。修改后请先保存。
                </p>
              )}
              {reuseNeeded.map(([base, secret]) => (
                <label className="settings-reuse check" key={base}>
                  <input
                    type="checkbox"
                    checked={reuseSecrets.includes(secret)}
                    onChange={(event) =>
                      setReuseSecrets((keys) =>
                        event.target.checked
                          ? [...keys, secret]
                          : keys.filter((key) => key !== secret),
                      )
                    }
                  />
                  将{aiFields[secret].label}的现有密钥用于新地址：{value(base)}
                </label>
              ))}
            </div>
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {message && (
            <p className="settings-message" role="status">
              <Check size={15} />
              {message}
            </p>
          )}
          <div className="ai-settings-footer">
            <span>
              {dirty
                ? `${Object.keys(changes).length} 项修改尚未保存`
                : "配置已同步 · 密钥不会回传到网页"}
            </span>
            <div className="row">
              <button
                disabled={busy || testing || loading}
                onClick={() => void reload()}
              >
                <RefreshCw size={15} />
                {dirty ? "放弃修改并重载" : "重新载入"}
              </button>
              <button
                className="primary"
                disabled={!dirty || busy || testing || loading}
                onClick={() => void save()}
              >
                {busy ? (
                  <LoaderCircle className="spinning" size={16} />
                ) : (
                  <Save size={16} />
                )}
                保存配置
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
