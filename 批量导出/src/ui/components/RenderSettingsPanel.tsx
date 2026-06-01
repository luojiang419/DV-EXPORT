import type { RenderOptionsResponse, RenderProfile } from "../../types/models";

interface RenderSettingsPanelProps {
  options: RenderOptionsResponse | null;
  profile: RenderProfile;
  namingTemplate: string;
  outputDirectory: string;
  onProfileChange(nextProfile: RenderProfile): void;
  onNamingTemplateChange(nextTemplate: string): void;
  onOutputDirectoryChange(): void;
}

function resolutionToValue(width: number, height: number): string {
  return `${width}x${height}`;
}

export function RenderSettingsPanel({
  options,
  profile,
  namingTemplate,
  outputDirectory,
  onProfileChange,
  onNamingTemplateChange,
  onOutputDirectoryChange
}: RenderSettingsPanelProps) {
  const formatOptions = options?.formats ?? [];
  const codecOptions = options?.codecs ?? [];
  const resolutionOptions = options?.resolutions ?? [];
  const frameRates = options?.frameRates ?? [];
  const presetOptions = options?.presets ?? [];
  const selectedResolutionValue =
    resolutionOptions.length > 0
      ? resolutionToValue(profile.resolution.width, profile.resolution.height)
      : "";

  return (
    <div className="settings-grid">
      <label className="field">
        <span className="field__label">基础预设</span>
        <select
          className="field__control"
          value={profile.presetName}
          onChange={(event) => onProfileChange({ ...profile, presetName: event.target.value })}
        >
          <option value="">不使用预设</option>
          {presetOptions.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.label}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span className="field__label">格式</span>
        <select
          className="field__control"
          disabled={formatOptions.length === 0}
          value={formatOptions.length > 0 ? profile.format : ""}
          onChange={(event) => onProfileChange({ ...profile, format: event.target.value })}
        >
          {formatOptions.length === 0 ? (
            <option value="">未读取到格式选项</option>
          ) : (
            formatOptions.map((format) => (
              <option key={format.id} value={format.id}>
                {format.label}
              </option>
            ))
          )}
        </select>
      </label>

      <label className="field">
        <span className="field__label">编码器</span>
        <select
          className="field__control"
          disabled={codecOptions.length === 0}
          value={codecOptions.length > 0 ? profile.codec : ""}
          onChange={(event) => onProfileChange({ ...profile, codec: event.target.value })}
        >
          {codecOptions.length === 0 ? (
            <option value="">未读取到编码器选项</option>
          ) : (
            codecOptions.map((codec) => (
              <option key={codec.id} value={codec.id}>
                {codec.label}
              </option>
            ))
          )}
        </select>
      </label>

      <label className="field">
        <span className="field__label">分辨率</span>
        <select
          className="field__control"
          disabled={resolutionOptions.length === 0}
          value={selectedResolutionValue}
          onChange={(event) => {
            const [width, height] = event.target.value.split("x").map((item) => Number(item));
            onProfileChange({ ...profile, resolution: { width, height } });
          }}
        >
          {resolutionOptions.length === 0 ? (
            <option value="">未读取到分辨率选项</option>
          ) : (
            resolutionOptions.map((resolution) => (
              <option
                key={resolutionToValue(resolution.width, resolution.height)}
                value={resolutionToValue(resolution.width, resolution.height)}
              >
                {resolution.width} × {resolution.height}
              </option>
            ))
          )}
        </select>
      </label>

      <label className="field">
        <span className="field__label">帧率</span>
        <select
          className="field__control"
          value={String(profile.frameRate)}
          onChange={(event) => onProfileChange({ ...profile, frameRate: Number(event.target.value) })}
        >
          {frameRates.map((frameRate) => (
            <option key={frameRate.id} value={frameRate.value}>
              {frameRate.label}
            </option>
          ))}
        </select>
      </label>

      <label className="field field--wide">
        <span className="field__label">命名模板</span>
        <input
          className="field__control"
          type="text"
          value={namingTemplate}
          onChange={(event) => onNamingTemplateChange(event.target.value)}
          placeholder="{timeline}_{date}_{index}"
        />
        <span className="field__hint">支持 token：{"{timeline}"} {"{project}"} {"{date}"} {"{time}"} {"{index}"}</span>
      </label>

      <div className="field field--wide">
        <span className="field__label">导出目录</span>
        <div className="path-picker">
          <input className="field__control" type="text" readOnly value={outputDirectory} placeholder="请选择输出路径" />
          <button className="action-button action-button--ghost" type="button" onClick={onOutputDirectoryChange}>
            选择目录
          </button>
        </div>
      </div>

      <div className="toggle-group field--wide">
        <label className="toggle">
          <input
            checked={profile.exportVideo}
            onChange={(event) => onProfileChange({ ...profile, exportVideo: event.target.checked })}
            type="checkbox"
          />
          <span>导出视频</span>
        </label>
        <label className="toggle">
          <input
            checked={profile.exportAudio}
            onChange={(event) => onProfileChange({ ...profile, exportAudio: event.target.checked })}
            type="checkbox"
          />
          <span>导出音频</span>
        </label>
      </div>
    </div>
  );
}
