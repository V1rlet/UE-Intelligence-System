export interface CodeQuickEntry {
	name: string;
	folder: string;
}

export interface CodeQuickGroup {
	id: "system" | "framework" | "capability";
	label: string;
	description: string;
	entries: CodeQuickEntry[];
}

/** Shared code-workspace shortcuts; every lens resolves the same engine facts. */
export const CODE_QUICK_GROUPS: CodeQuickGroup[] = [
	{
		id: "system",
		label: "系统工具",
		description: "通用蓝图库与基础工具",
		entries: [
			{ name: "UGameplayStatics", folder: "Engine / Kismet" },
			{ name: "UKismetSystemLibrary", folder: "Engine / Kismet" },
			{ name: "UKismetMathLibrary", folder: "Engine / Kismet" },
			{ name: "UKismetStringLibrary", folder: "Engine / Kismet" },
		],
	},
	{
		id: "framework",
		label: "Gameplay 框架",
		description: "对象、控制权与比赛规则骨架",
		entries: [
			{ name: "AActor", folder: "Engine / GameFramework" },
			{ name: "APawn", folder: "Engine / GameFramework" },
			{ name: "ACharacter", folder: "Engine / GameFramework" },
			{ name: "APlayerController", folder: "Engine / GameFramework" },
			{ name: "AGameModeBase", folder: "Engine / GameFramework" },
			{ name: "AGameStateBase", folder: "Engine / GameFramework" },
			{ name: "APlayerState", folder: "Engine / GameFramework" },
		],
	},
	{
		id: "capability",
		label: "玩法能力",
		description: "组件、移动、输入、动画、AI 与 GAS",
		entries: [
			{ name: "UActorComponent", folder: "Engine / Components" },
			{ name: "UCharacterMovementComponent", folder: "Engine / GameFramework" },
			{ name: "UEnhancedInputComponent", folder: "EnhancedInput" },
			{ name: "UAnimInstance", folder: "Engine / Animation" },
			{ name: "AAIController", folder: "AIModule" },
			{ name: "UAbilitySystemComponent", folder: "GameplayAbilities" },
			{ name: "UGameplayAbility", folder: "GameplayAbilities" },
		],
	},
];

export const CODE_QUICK_ENTRIES = CODE_QUICK_GROUPS.flatMap((group) =>
	group.entries.map((entry) => ({ ...entry, group: group.id })),
);

