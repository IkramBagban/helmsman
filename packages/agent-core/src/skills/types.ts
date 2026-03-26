export interface SkillDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly skillPath: string;
  readonly keywords: readonly string[];
  readonly priority: number;
  readonly alwaysOn?: boolean;
  readonly requires?: SkillRequirements;
}

export interface SkillRequirements {
  readonly bins?: readonly string[];
  readonly env?: readonly string[];
}

export interface SkillEligibility {
  readonly eligible: boolean;
  readonly missingBins: readonly string[];
  readonly missingEnv: readonly string[];
}

export interface LoadedSkillDoc {
  readonly name: string;
  readonly description: string;
  readonly body: string;
  readonly sourcePath: string;
}

export interface SelectedSkill {
  readonly skill: SkillDefinition;
  readonly score: number;
  readonly document: LoadedSkillDoc;
  readonly eligibility: SkillEligibility;
}
