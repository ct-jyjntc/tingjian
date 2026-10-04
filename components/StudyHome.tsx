"use client";

import { useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  AudioLines,
  BookOpen,
  Camera,
  Check,
  ChevronRight,
  Clock3,
  FileText,
  Headphones,
  Mic,
  PenLine,
  ScanLine,
  ShieldCheck,
  Sparkles,
  Sprout,
} from "lucide-react";
import type { Session } from "@/lib/types";
import styles from "./StudyHome.module.css";

type Props = {
  ready: boolean;
  busy: boolean;
  draftCount: number;
  hasDraft: boolean;
  session: Session | null;
  history: Session[];
  wrongCount: number;
  onCamera: () => void;
  onUpload: () => void;
  onDrop: (files: File[]) => void;
  onText: () => void;
  onDraft: () => void;
  onHistory: () => void;
  onWrong: () => void;
  onResume: (session: Session) => void;
};

export default function StudyHome(props: Props) {
  const [dragging, setDragging] = useState(false);
  const disabled = !props.ready || props.busy;
  const ongoing = props.session?.phase !== "completed" ? props.session : null;
  const completed = props.history.filter(
    (session) => session.phase === "completed",
  ).length;

  return (
    <div className={styles.home}>
      <div className={styles.heading}>
        <div>
          <span className={styles.eyebrow}>YOUR LITTLE LEARNING STUDIO</span>
          <h1>今天也，慢慢进步。</h1>
          <p>把一点时间留给专注，把每一次练习交给听见。</p>
        </div>
        <span className={styles.headingNote}>
          <Sprout size={17} /> 每一次练习，都算数
        </span>
      </div>

      <section
        className={`${styles.hero} ${dragging ? styles.dragging : ""}`}
        aria-label="开始新的听写"
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
            setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (!disabled) props.onDrop(Array.from(event.dataTransfer.files));
        }}
      >
        <div className={styles.heroMain}>
          <div className={styles.heroCopy}>
            <span className={styles.tag}>
              <span /> 你的 AI 听写搭档
            </span>
            <h2>
              你来认真写，
              <br />
              我来<span>慢慢读。</span>
            </h2>
            <p>
              拍下课本，圈出重点。
              <br />
              不用等人报听写，学习也可以很从容。
            </p>
            <div className={styles.actions}>
              <button
                className={styles.primary}
                disabled={disabled}
                onClick={props.onCamera}
              >
                <Camera size={18} /> 拍照开始听写 <ArrowRight size={17} />
              </button>
              <button
                className={styles.secondary}
                disabled={disabled}
                onClick={props.onUpload}
              >
                <ArrowDownToLine size={18} /> 上传图片
              </button>
            </div>
            <button
              className={styles.textLink}
              disabled={disabled}
              onClick={props.onText}
            >
              <PenLine size={14} /> 也可以直接输入听写内容{" "}
              <ChevronRight size={14} />
            </button>
          </div>

          <div className={styles.illustration} aria-hidden="true">
            <div className={styles.halo} />
            <span className={styles.decorStar}>✳</span>
            <span className={styles.decorDot} />
            <div className={styles.backPage} />
            <div className={styles.notebook}>
              <div className={styles.bookBinding}>
                <i />
                <i />
                <i />
                <i />
                <i />
              </div>
              <div className={styles.notebookHeading}>
                <span>今天的听写清单</span>
                <span>WORDS / 01</span>
              </div>
              <div className={styles.word}>
                <span>01</span>
                <strong>春天</strong>
                <em>spring</em>
                <Check size={15} />
              </div>
              <div className={`${styles.word} ${styles.selectedWord}`}>
                <span>02</span>
                <strong>生长</strong>
                <em>grow</em>
                <ScanLine size={18} />
              </div>
              <div className={styles.word}>
                <span>03</span>
                <strong>可能</strong>
                <em>possibility</em>
              </div>
              <div className={styles.bookNote}>
                一点一滴，都是向前。<span>↗</span>
              </div>
            </div>
            <div className={styles.pencil}>
              <i />
            </div>
            <div className={styles.audioCard}>
              <span className={styles.audioIcon}>
                <Headphones size={24} />
              </span>
              <div>
                <strong>不着急，等你写好</strong>
                <small>你的节奏，刚刚好</small>
              </div>
              <div className={styles.wave}>
                {[9, 18, 29, 16, 24, 34, 19, 11].map((height, index) => (
                  <i key={index} style={{ height }} />
                ))}
              </div>
            </div>
            <div className={styles.sticker}>
              <Sparkles size={15} /> 为每一点进步，留个位置
            </div>
          </div>
        </div>
        <div className={styles.steps}>
          {[
            {
              number: "01",
              icon: Camera,
              title: "拍下学习内容",
              detail: "课本、词表、笔记都可以",
            },
            {
              number: "02",
              icon: ScanLine,
              title: "圈选并确认",
              detail: "AI 提取，你来决定听写什么",
            },
            {
              number: "03",
              icon: AudioLines,
              title: "跟着自己的节奏",
              detail: "写好了，再继续下一项",
            },
          ].map((step) => (
            <div className={styles.step} key={step.number}>
              <span className={styles.stepNumber}>{step.number}</span>
              <step.icon size={19} />
              <div>
                <strong>{step.title}</strong>
                <small>{step.detail}</small>
              </div>
              <ChevronRight size={15} />
            </div>
          ))}
        </div>
        {dragging && (
          <div className={styles.dropOverlay}>
            <ArrowDownToLine size={36} />
            <strong>松开图片，开始这次听写</strong>
          </div>
        )}
      </section>

      <div className={styles.dashboard}>
        <section className={styles.practice}>
          <div className={styles.sectionHead}>
            <h2>
              <Clock3 size={17} /> 接着上次的小进步
            </h2>
            <button onClick={props.onHistory}>
              全部记录 <ArrowRight size={14} />
            </button>
          </div>
          {ongoing ? (
            <div className={styles.resume}>
              <span className={styles.bookIcon}>
                <BookOpen size={23} />
              </span>
              <div className={styles.resumeInfo}>
                <h3>
                  {ongoing.items
                    .slice(0, 3)
                    .map((item) => item.answer)
                    .join("、") || "未完成的听写"}
                </h3>
                <p>
                  第 {ongoing.index + 1} / {ongoing.items.length} 项 ·
                  进度已保存
                </p>
                <div className={styles.progress}>
                  <span
                    style={{
                      width: `${(ongoing.index / Math.max(1, ongoing.items.length)) * 100}%`,
                    }}
                  />
                </div>
              </div>
              <button
                className={styles.resumeButton}
                onClick={() => props.onResume(ongoing)}
                aria-label="继续听写"
              >
                <ArrowRight size={19} />
              </button>
            </div>
          ) : (
            <div className={styles.empty}>
              <span className={styles.emptyBooks}>
                <BookOpen size={29} />
              </span>
              <div>
                <h3>
                  {props.ready ? "新的一页，等你开启" : "正在打开你的学习空间…"}
                </h3>
                <p>从一个词开始，也是一点进步。</p>
              </div>
            </div>
          )}
          {props.hasDraft ? (
            <button
              className={styles.draft}
              disabled={disabled}
              onClick={props.onDraft}
            >
              <FileText size={16} />
              <span>
                继续编辑清单 <small>{props.draftCount} 项内容</small>
              </span>
              <ChevronRight size={16} />
            </button>
          ) : (
            <div className={styles.savedNote}>
              <ShieldCheck size={14} /> 练习进度会自动保存在当前浏览器
            </div>
          )}
        </section>

        <section className={styles.voiceTip}>
          <div className={styles.tipLabel}>
            <Mic size={15} /> 听写小贴士 <span>JUST SAY IT</span>
          </div>
          <h2>说一声，就懂你。</h2>
          <div className={styles.commands}>
            <div>
              <strong>“写完啦”</strong>
              <small>继续下一项</small>
            </div>
            <div>
              <strong>“没跟上”</strong>
              <small>再读一次</small>
            </div>
            <div>
              <strong>“讲讲这个”</strong>
              <small>语音讲解</small>
            </div>
          </div>
          <p>开启语音对话后，自然表达就好，也可以输入文字。</p>
        </section>

        <section className={styles.footprints}>
          <h2>
            <Sprout size={17} /> 你的学习足迹
          </h2>
          <div className={styles.statRow}>
            <span>已结束练习</span>
            <strong>
              {props.ready ? completed : "—"}
              <small>次</small>
            </strong>
          </div>
          <button className={styles.statRow} onClick={props.onWrong}>
            <span>待温习的错词</span>
            <strong>
              {props.ready ? props.wrongCount : "—"}
              <small>个</small>
            </strong>
            <ChevronRight size={14} />
          </button>
          <p>不必赶路，记住一点就好。</p>
        </section>
      </div>
      <div className={styles.privacy}>
        <ShieldCheck size={14} />
        <span>进度留在你的浏览器，图片默认不长期保存。</span>
        <span>安心学，慢慢来。</span>
      </div>
    </div>
  );
}
