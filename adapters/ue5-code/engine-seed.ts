// Graph Brain / adapters/ue5-code - 引擎种子层：常见引擎类的继承链与一句话职责
//
// 用途：项目类的 Spec 视图需要"从根（UObject）到该类"的可跳转继承链；引擎源码
// 全量解析尚未接入（后续 unit 用真实 .h 解析替换本表），先以人工整理的稳定事实支撑。
// 链条方向：根 → 派生（数组头是 UObject）。

/** 引擎类 → 从 UObject 到该类的完整链（含自身） */
const CHAINS: Record<string, string[]> = {
	UObject: ["UObject"],
	AActor: ["UObject", "AActor"],
	APawn: ["UObject", "AActor", "APawn"],
	ACharacter: ["UObject", "AActor", "APawn", "ACharacter"],
	AController: ["UObject", "AActor", "AController"],
	APlayerController: ["UObject", "AActor", "AController", "APlayerController"],
	AInfo: ["UObject", "AActor", "AInfo"],
	AGameModeBase: ["UObject", "AActor", "AInfo", "AGameModeBase"],
	UActorComponent: ["UObject", "UActorComponent"],
	USceneComponent: ["UObject", "UActorComponent", "USceneComponent"],
	USpringArmComponent: ["UObject", "UActorComponent", "USceneComponent", "USpringArmComponent"],
	UCameraComponent: ["UObject", "UActorComponent", "USceneComponent", "UCameraComponent"],
	UInputComponent: ["UObject", "UActorComponent", "UInputComponent"],
	UUserWidget: ["UObject", "UUserWidget"],
	UInputAction: ["UObject", "UInputAction"],
	UInputMappingContext: ["UObject", "UInputMappingContext"],
};

const DESCRIPTIONS: Record<string, string> = {
	UObject: "UE 对象系统的根：反射/GC/序列化的载体",
	AActor: "可放入关卡的实体：Transform、组件容器、复制单元",
	APawn: "可被 Controller 附身的 Actor",
	ACharacter: "带 CharacterMovement 与胶囊体的人形角色基类",
	AController: "附身并驱动 Pawn 的非实体 Actor",
	APlayerController: "玩家输入与视口的桥梁：输入栈、HUD、相机管理",
	AInfo: "无实体表现的信息类 Actor 基类",
	AGameModeBase: "服务器权威的对局规则：出生点、玩家加入流程",
	UActorComponent: "可挂载到 Actor 的功能单元（无 Transform）",
	USceneComponent: "带 Transform、可形成层级的组件",
	USpringArmComponent: "弹簧臂：相机跟随与碰撞回缩",
	UCameraComponent: "相机视点组件",
	UInputComponent: "输入绑定的运行时载体",
	UUserWidget: "UMG 用户控件基类",
	UInputAction: "Enhanced Input 的输入动作资产",
	UInputMappingContext: "Enhanced Input 的按键映射上下文资产",
};

export function seedChainOf(className: string): string[] | null {
	return CHAINS[className] ?? null;
}

export function seedDescriptionOf(className: string): string {
	return DESCRIPTIONS[className] ?? "";
}
