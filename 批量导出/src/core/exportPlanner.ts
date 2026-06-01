import { formatNamingTemplate } from "./naming";
import { buildResolveRenderSettings, type ResolveRenderSettings } from "./renderSettings";
import type { RenderProfile, TimelineEntry } from "../types/models";

export interface ExportJobPlan {
  timeline: TimelineEntry;
  outputName: string;
  outputDirectory: string;
  renderSettings: ResolveRenderSettings;
}

export function createExportJobPlans(args: {
  timelines: TimelineEntry[];
  profile: RenderProfile;
  outputDirectory: string;
  namingTemplate: string;
  projectName: string;
  now?: Date;
}): ExportJobPlan[] {
  return args.timelines.map((timeline, index) => {
    const outputName = formatNamingTemplate(args.namingTemplate, {
      timeline: timeline.name,
      project: args.projectName,
      index: index + 1,
      now: args.now
    });

    return {
      timeline,
      outputName,
      outputDirectory: args.outputDirectory,
      renderSettings: buildResolveRenderSettings(args.profile, args.outputDirectory, outputName)
    };
  });
}
