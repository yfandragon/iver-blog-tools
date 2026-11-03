import { useEffect, useMemo, useState } from 'react';
import type { ArticleTask, ProgressEvent, ProviderStatus } from '../shared/types';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `请求失败（${response.status}）`);
  return data as T;
}

function jsonBody(value: unknown): RequestInit {
  return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) };
}

export function App() {
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [task, setTask] = useState<ArticleTask | null>(null);
  const [targetPath, setTargetPath] = useState('');
  const [model, setModel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [progress, setProgress] = useState('');
  const [confirmPublish, setConfirmPublish] = useState(false);

  const selectedModel = useMemo(() => providers.find((provider) => provider.id === 'codex')?.models.find((item) => item.id === model), [providers, model]);

  async function refreshProviders() {
    const result = await request<{ providers: ProviderStatus[] }>('/api/providers');
    setProviders(result.providers);
    const firstUsable = result.providers.find((provider) => provider.id === 'codex')?.models.find((item) => item.imageCapability === 'verified');
    if (!model && firstUsable) setModel(firstUsable.id);
  }

  useEffect(() => {
    document.querySelectorAll<HTMLInputElement>('input[data-folder-picker]').forEach((input) => input.setAttribute('webkitdirectory', ''));
    void refreshProviders().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : '无法连接本地服务'));
    if (!task?.id) return;
    const events = new EventSource(`/api/tasks/${task.id}/events`);
    events.addEventListener('snapshot', (event) => {
      try { setTask((JSON.parse((event as MessageEvent<string>).data) as { task: ArticleTask }).task); } catch { /* ignore malformed local event */ }
    });
    events.addEventListener('progress', (event) => {
      try {
        const progressEvent = JSON.parse((event as MessageEvent<string>).data) as ProgressEvent;
        setProgress(progressEvent.message);
        void request<{ task: ArticleTask }>(`/api/tasks/${task.id}`).then((result) => setTask(result.task)).catch(() => undefined);
      } catch { /* ignore malformed local event */ }
    });
    return () => events.close();
  }, [task?.id]);

  async function handleImport(selection?: FileList | File[]) {
    if (!selection?.length) return;
    const files = Array.from(selection);
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const form = new FormData();
      form.append('manifest', JSON.stringify(files.map((file) => ({ path: file.webkitRelativePath || file.name }))));
      files.forEach((file, index) => form.append('files', file, `upload-${index}`));
      const result = await request<{ task: ArticleTask }>('/api/tasks/import', { method: 'POST', body: form });
      setTask(result.task);
      setNotice(result.task.entryPath ? `${result.task.format === 'html' ? 'HTML' : 'Markdown'}已导入；原稿与资源包保持原样。` : '导入包有多个Markdown/HTML候选入口，请先选择要导入的文件。');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '导入失败');
    } finally {
      setBusy(false);
    }
  }

  async function patchTask(patch: Partial<ArticleTask>) {
    if (!task) return;
    try {
      const result = await request<{ task: ArticleTask }>(`/api/tasks/${task.id}`, jsonBody(patch));
      setTask(result.task);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败');
      return false;
    }
  }

  async function runAction(action: () => Promise<void>, doneMessage?: string) {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      await action();
      if (doneMessage) setNotice(doneMessage);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '操作失败');
    } finally {
      setBusy(false);
    }
  }

  const codex = providers.find((provider) => provider.id === 'codex');
  const agy = providers.find((provider) => provider.id === 'antigravity');
  const title = task?.title || '导入一篇文章';

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="IverBlog Tools 首页">
          <span className="brand-mark" aria-hidden="true"><span /></span>
          <span><strong>IverBlog Tools</strong><small>作者工作台</small></span>
        </a>
        <div className="topbar-status"><span className="status-dot" />本机运行</div>
      </header>

      <main id="top" className="workspace">
        <section className="welcome-row">
          <div>
            <p className="eyebrow">文章工作台</p>
            <h1>把文章送进真实博客</h1>
            <p className="welcome-copy">正文由你完成。这里负责封面、元数据和发布前校样。</p>
          </div>
          <div className="import-actions">
            <label className={`import-button ${busy ? 'is-disabled' : ''}`}>
              <input type="file" accept=".md,.markdown,.html,.htm,.zip,text/markdown,text/html,application/zip" disabled={busy} onChange={(event) => { void handleImport(event.target.files ?? undefined); event.currentTarget.value = ''; }} />
              {task ? '换一篇笔记 / ZIP' : '选择笔记 / ZIP'}
            </label>
            <label className={`import-button import-folder ${busy ? 'is-disabled' : ''}`}>
              <input type="file" multiple data-folder-picker disabled={busy} onChange={(event) => { void handleImport(event.target.files ?? undefined); event.currentTarget.value = ''; }} />
              选择文件夹
            </label>
          </div>
          <p className="import-limit-note">文件夹导入受浏览器 File API 限制，不能识别符号链接；需要检查链接时请使用 ZIP 导入。</p>
        </section>

        <nav className="workflow" aria-label="文章处理步骤">
          <div className={`workflow-step ${task ? 'is-done' : 'is-current'}`}><span>1</span><div><strong>文章</strong><small>导入并确认信息</small></div></div>
          <i aria-hidden="true" />
          <div className={`workflow-step ${task?.cover ? 'is-done' : task ? 'is-current' : ''}`}><span>2</span><div><strong>封面</strong><small>生成并检查文件</small></div></div>
          <i aria-hidden="true" />
          <div className={`workflow-step ${task?.previewUrl ? 'is-current' : ''}`}><span>3</span><div><strong>实览</strong><small>检查真实博客效果</small></div></div>
        </nav>

        {(error || notice || progress) && <div className={`feedback ${error ? 'feedback-error' : 'feedback-success'}`} role={error ? 'alert' : 'status'}>{error || notice || progress}</div>}

        <div className="workbench-grid">
          <section className="editor-column" aria-label="文章编辑区">
            <div className="section-heading">
              <div><p className="eyebrow">稿件信息</p><h2>{title}</h2></div>
              {task && <span className="draft-state">{task.status === 'published' ? '已推送' : task.status === 'committed' ? '已提交，推送未完成' : task.status === 'prepared' || task.status === 'previewing' ? '本地校样' : '本地草稿'}</span>}
            </div>

            {!task ? (
              <div className="empty-import">
                <div className="document-icon" aria-hidden="true"><span /><span /><span /></div>
                <h3>导入一篇笔记</h3>
                <p>支持 Markdown、HTML、带资源的文件夹和 ZIP。原稿不会被改写。</p>
                <div className="empty-import-actions">
                  <label className="text-link">选择笔记或 ZIP<input type="file" accept=".md,.markdown,.html,.htm,.zip,text/markdown,text/html,application/zip" onChange={(event) => { void handleImport(event.target.files ?? undefined); event.currentTarget.value = ''; }} /></label>
                  <label className="text-link">选择文件夹<input type="file" multiple data-folder-picker onChange={(event) => { void handleImport(event.target.files ?? undefined); event.currentTarget.value = ''; }} /></label>
                </div>
              </div>
            ) : (
              <>
                <div className="source-line"><span className="file-glyph" aria-hidden="true">{task.format === 'html' ? 'HTML' : task.format === 'markdown' ? 'MD' : 'PKG'}</span><span>{task.sourceName}</span><span className="body-kept">原始文件已保留</span></div>
                {!task.entryPath && <label className="field entry-choice"><span>选择要导入的入口文件</span><select value="" onChange={(event) => { void patchTask({ entryPath: event.target.value }); }}><option value="" disabled>请选择 Markdown 或 HTML 文件</option>{task.entryCandidates?.map((candidate) => <option key={candidate} value={candidate}>{candidate}</option>)}</select></label>}
                {!task.entryPath ? <div className="warning-list"><strong>需要选择入口</strong><p>一个包中发现多个笔记文件。选择后才会读取对应正文和资源。</p></div> : <>
                <div className="entry-meta"><span>格式：{task.format === 'html' ? 'HTML 原稿' : 'Markdown'}</span><span>入口：<code>{task.entryPath}</code></span></div>
                <div className="field-grid">
                  <label className="field field-wide"><span>文章标题</span><input value={task.title} onChange={(event) => setTask({ ...task, title: event.target.value })} onBlur={() => void patchTask({ title: task.title })} maxLength={160} /></label>
                  <label className="field"><span>发布日期</span><input type="date" value={task.publishedAt} onChange={(event) => { const value = event.target.value; setTask({ ...task, publishedAt: value }); }} onBlur={() => void patchTask({ publishedAt: task.publishedAt })} /></label>
                  <label className="field field-wide"><span>文章摘要</span><textarea value={task.description} onChange={(event) => setTask({ ...task, description: event.target.value })} onBlur={() => void patchTask({ description: task.description })} rows={3} maxLength={360} placeholder="简短介绍文章解决的问题或记录的内容" /></label>
                </div>
                {!task.description && <button className="quiet-button" disabled={busy} onClick={() => void runAction(async () => { const result = await request<{ task: ArticleTask }>(`/api/tasks/${task.id}/description`, jsonBody({ model })); setTask(result.task); }, '摘要草稿已生成，可继续修改。')}>让 Codex 起草摘要</button>}

                {task.warnings.length > 0 && <div className="warning-list"><strong>继续前需要检查</strong>{task.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div>}
                {Boolean(task.blockers?.length) && <div className="blocker-list" role="alert"><strong>这些问题会阻止准备预览</strong>{task.blockers?.map((blocker) => <p key={blocker}>{blocker}</p>)}</div>}
                {Boolean(task.resourceManifest?.length) && <section className="resource-section"><div className="subsection-heading"><div><p className="eyebrow">导入包</p><h3>资源清单</h3></div><span className="version-tag">{task.resourceManifest?.length} 项</span></div><ul className="resource-list">{task.resourceManifest?.map((item) => <li key={`${item.path}-${item.references.join(',')}`}><span className={`resource-state state-${item.status}`}>{({ ready: '可用', unused: '未引用', external: '外链', missing: '缺失', blocked: '阻塞' } as const)[item.status]}</span><code>{item.path}</code>{item.reason && <small>{item.reason}</small>}{item.references.length > 0 && <small>引用位置：{item.references.join('、')}</small>}</li>)}</ul></section>}

                <section className="cover-section">
                  <div className="subsection-heading"><div><p className="eyebrow">文章封面</p><h3>先做一张校样</h3></div><span className="version-tag">{task.promptVersion}</span></div>
                  <label className="field"><span>本次生成提示词</span><textarea className="prompt-input" value={task.prompt} onChange={(event) => setTask({ ...task, prompt: event.target.value })} onBlur={() => void patchTask({ prompt: task.prompt })} rows={6} /></label>
                  <div className="provider-row">
                    <label className="field provider-select"><span>生成入口</span><select value="codex" disabled><option value="codex">Codex CLI {codex?.installed ? `· ${codex.version}` : '· 未安装'}</option></select></label>
                    <label className="field provider-select"><span>推理模型</span><select value={model} onChange={(event) => setModel(event.target.value)} disabled={!codex?.models.length}>{(codex?.models ?? []).map((item) => <option key={item.id} value={item.id}>{item.displayName}{item.imageCapability === 'verified' ? ' · Codex生图路径曾实测' : ' · 生图未实测'}</option>)}</select></label>
                  </div>
                  {agy && <p className="provider-note"><span className="lock-mark" aria-hidden="true">⌑</span><span><strong>Antigravity 暂未启用</strong>调用资格确认前不会启动 `agy`。</span></p>}
                  <div className="cover-actions">
                    <button className="primary-button" disabled={busy || !codex?.installed || selectedModel?.imageCapability !== 'verified'} onClick={() => void runAction(async () => { const result = await request<{ task: ArticleTask }>(`/api/tasks/${task.id}/cover`, jsonBody({ model })); setTask(result.task); }, '图片文件已取回并通过解码检查。')}>{busy ? '正在处理…' : task.cover ? '再生成一张' : '生成封面'}</button>
                    <span>只生成到本地任务目录，不会改博客文件。</span>
                  </div>
                </section>
                </>}
              </>
            )}

            {task?.cover && (
              <section className="target-section">
                <div className="subsection-heading"><div><p className="eyebrow">目标博客</p><h3>在真实页面里校样</h3></div></div>
                <label className="field"><span>本地 Astro 仓库路径</span><input value={targetPath} onChange={(event) => setTargetPath(event.target.value)} placeholder="/Users/you/projects/my-blog" spellCheck={false} /></label>
                <div className="target-actions">
                  <button className="secondary-button" disabled={busy || !targetPath.trim() || !task.entryPath || !task.title.trim() || !task.description.trim() || !task.publishedAt || Boolean(task.blockers?.length)} onClick={() => void runAction(async () => { if (!(await patchTask({ title: task.title, description: task.description, publishedAt: task.publishedAt, prompt: task.prompt }))) throw new Error('请先修正并保存稿件信息。'); const result = await request<{ task: ArticleTask }>(`/api/tasks/${task.id}/prepare`, jsonBody({ targetPath: targetPath.trim() })); setTask(result.task); }, '文章、原稿、资源和封面已准备到所选仓库。')}>准备本地预览</button>
                  {task.previewUrl && <a className="quiet-link" href={task.previewUrl} target="_blank" rel="noreferrer">在新标签打开博客</a>}
                </div>
                {task.diff && <div className="diff-box"><div className="diff-heading"><strong>本次改动</strong><span>{task.diff.length} 个文件</span></div>{task.diff.map((file) => <details key={file.path} className="diff-file"><summary><span>{file.change === 'added' ? '新增' : '修改'}</span><code>{file.path}</code></summary><pre>{file.patch}</pre></details>)}</div>}
                {task.previewUrl && <div className="preview-links"><span>分支：<code>{task.currentBranch || '未知'}</code></span><a href={task.previewUrl} target="_blank" rel="noreferrer">首页卡片</a><a href={task.articlePreviewUrl} target="_blank" rel="noreferrer">文章页面</a>{task.fullPagePreviewUrl && <a href={task.fullPagePreviewUrl} target="_blank" rel="noreferrer">完整 HTML 页面</a>}</div>}
                {task.previewUrl && task.diff && <div className="publish-row"><button className="publish-button" disabled={busy || task.status === 'published'} onClick={() => setConfirmPublish(true)}>{task.status === 'published' ? '已推送' : '确认提交并推送'}</button><span>推送前会再次核对分支和文件范围。</span></div>}
              </section>
            )}
          </section>

          <aside className="proof-column" aria-label="文章封面与博客预览">
            <div className="proof-header"><div><p className="eyebrow">校样</p><h2>{task?.previewUrl ? '真实博客实览' : '封面印样'}</h2></div><span className="proof-stamp">LOCAL</span></div>
            {task?.previewUrl ? (
              <div className="site-frame"><div className="frame-bar"><span /><span /><span /><small>{new URL(task.previewUrl).host}</small></div><iframe title="目标博客本地预览" src={task.previewUrl} /></div>
            ) : task?.cover ? (
              <figure className="cover-proof"><img src={`/api/tasks/${task.id}/cover`} alt={task.coverAlt || '文章封面候选'} /><figcaption><span>{task.cover.width} × {task.cover.height}</span><span>{(task.cover.bytes / 1024 / 1024).toFixed(2)} MB</span></figcaption></figure>
            ) : (
              <div className="proof-empty"><div className="landscape-mark" aria-hidden="true"><span /><i /><b /></div><p>封面生成后会在这里显示。</p><small>真实博客预览将在选定目标仓库后启动。</small></div>
            )}
            {task?.cover && task.previewUrl && <div className="proof-cover-thumb"><img src={`/api/tasks/${task.id}/cover`} alt="本次封面候选" /><div><strong>本次封面</strong><span>{task.cover.width} × {task.cover.height}</span></div></div>}
            <div className="provider-status">
              <p className="eyebrow">本机工具</p>
              <div className="provider-status-row"><span className={`status-dot ${codex?.installed ? '' : 'status-dot-off'}`} /><div><strong>Codex CLI</strong><small>{codex?.message ?? '正在检查…'}</small></div></div>
              <div className="provider-status-row provider-disabled"><span className="status-dot status-dot-off" /><div><strong>Antigravity CLI</strong><small>许可确认前保持关闭</small></div></div>
            </div>
          </aside>
        </div>
      </main>

      {confirmPublish && task && <div className="dialog-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setConfirmPublish(false); }}><section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="publish-title"><p className="eyebrow">最后检查</p><h2 id="publish-title">提交并推送这篇文章？</h2><p>只会提交本次任务列出的文件。未暂存的其他工作会留在本地。</p><ul className="confirm-diffs">{task.diff?.map((file) => <li key={file.path}><details open><summary><code>{file.path}</code></summary><pre>{file.patch}</pre></details></li>)}</ul><p className="confirm-destination">分支：{task.currentBranch || '未知'}<br />推送目标：{task.pushTarget || '未设置'}</p><div className="dialog-actions"><button className="quiet-button" onClick={() => setConfirmPublish(false)}>返回检查</button><button className="publish-button" disabled={busy} onClick={() => { setConfirmPublish(false); void runAction(async () => { const result = await request<{ task: ArticleTask }>(`/api/tasks/${task.id}/publish`, jsonBody({ confirm: 'commit-and-push' })); setTask(result.task); }, '推送已完成；线上部署状态需另行确认。'); }}>{task.status === 'committed' ? '确认重试推送' : '确认提交并推送'}</button></div></section></div>}

      <footer className="footer"><span>所有操作都在这台电脑上进行。</span><span>正文不会被工具改写。</span></footer>
    </div>
  );
}
