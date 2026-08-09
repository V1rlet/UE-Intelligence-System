// Graph Brain / tests - header-parser 回归测试：注释剥离、成员语义、访问标签截断、委托与多类型解析
// 提取器是全链路最上游也最易碎的环节，这里覆盖历史踩坑点与核心语义映射。

import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { extractClassGraph } from "../adapters/ue5-code/extract-classes-lib.js";
import {
	guessTypeByName,
	parseCppDelegateBindings,
	parseCppMemberUsage,
	parseHeader,
	stripCommentsPreserveLength,
	type ParsedClass,
} from "../adapters/ue5-code/header-parser.js";

// ████████████████████████████████████████████████████████████████████████████
//  夹具：一个覆盖全部解析路径的合成头文件
// ████████████████████████████████████████████████████████████████████████████

const HEADER_FIXTURE = `// ZzTest - 合成夹具头文件
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "ZzWidget.generated.h"

// UPROPERTY() TObjectPtr<UFakeFromLineComment> FakeProp;
/* UPROPERTY() TObjectPtr<UFakeFromBlockComment> FakeProp2; */

class FZzForwardOnly;

/** 头文件级纯 C++ 辅助类。 */
class ZZ_API FZzPlainHelper : public FZzPlainBase
{
public:
	struct FNestedDetail {};
};

struct FZzPlainPayload
{
	int32 Count = 0;
};

enum class EZzPlainMode : uint8
{
	First,
	Second,
};

// class FCommentOnly { };

/** 开火委托：功率 */
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnZzFired, float, Power);
DECLARE_DELEGATE_RetVal(bool, FCanZzExecute);

/** Zz 武器角色。 */
UCLASS(Abstract, Blueprintable)
class ZZ_API AZzWidget : public AActor, public IZzAble
{
	GENERATED_BODY()

public:
	AZzWidget();
	virtual ~AZzWidget();

	/** 攻击入口。 */
	UFUNCTION(BlueprintCallable, Category = "Zz|Combat")
	void DoAttack(int32 Power, bool bQueued = true);

	int32 Value() const;

protected:
	virtual void BeginPlay() override;

	void SetRatio(float);

	static AZzWidget* MakeWidget();
	void HandleCompChanged(float Value);
	void OnZz() override;

	FORCEINLINE int32 GetCachedValue() const { return CachedValue; }

	UPROPERTY(EditDefaultsOnly, Category = "Zz")
	TObjectPtr<UZzComponent> Comp;

	UPROPERTY()
	TArray<TObjectPtr<UZzItem>> Items;

	UPROPERTY()
	TWeakObjectPtr<AZzBoss> BossRef;

	UPROPERTY()
	TSubclassOf<AZzProjectile> ProjectileClass;

	UPROPERTY()
	uint8 bArmed : 1;

	UPROPERTY()
	bool bReplicated;

	UPROPERTY(BlueprintAssignable)
	FOnZzFired OnFired;

private:
	FOnZzFired OnFiredBare;

	int32 CachedValue = 0;
};

UCLASS()
class ZZ_API UZzComponent : public UActorComponent
{
	GENERATED_BODY()

	FOnZzFired OnChanged;
};

USTRUCT(BlueprintType)
struct FZzStat
{
	GENERATED_USTRUCT_BODY()

	UPROPERTY()
	float Hp = 0.f;
};

UENUM(BlueprintType)
enum class EZzState : uint8
{
	Idle,
	Armed,
};

UINTERFACE(MinimalAPI, Blueprintable)
class UZzAble : public UInterface
{
	GENERATED_BODY()
};

class ZZ_API IZzAble
{
	GENERATED_IINTERFACE_BODY()

public:
	virtual void OnZz() = 0;
};
`;

const CPP_FIXTURE = `#include "ZzWidget.h"

void AZzWidget::DoAttack(int32 Power, bool bQueued)
{
	if (Comp)
	{
		bArmed = true;
	}
}

void AZzWidget::BeginPlay()
{
	Super::BeginPlay();
	Items.Empty();
	Comp->OnChanged.AddUObject(this, &AZzWidget::HandleCompChanged);
}
`;

function parseFixture(): { classes: ParsedClass[]; dir: string } {
	const dir = mkdtempSync(join(tmpdir(), "gb-header-"));
	writeFileSync(join(dir, "ZzWidget.h"), HEADER_FIXTURE, "utf-8");
	writeFileSync(join(dir, "ZzWidget.cpp"), CPP_FIXTURE, "utf-8");
	return { classes: parseHeader(join(dir, "ZzWidget.h"), dir), dir };
}

function mustFind(classes: ParsedClass[], name: string): ParsedClass {
	const c = classes.find((x) => x.name === name);
	assert.ok(c, `解析结果缺少 ${name}`);
	return c;
}

// ████████████████████████████████████████████████████████████████████████████
//  注释剥离
// ████████████████████████████████████████████████████████████████████████████

test("注释剥离保持等长，字符串字面量内的 // 不受影响", () => {
	const src = `FString Url = "http://x"; // 尾注释\n/* 块 */ int32 A;`;
	const { stripped } = stripCommentsPreserveLength(src);
	assert.equal(stripped.length, src.length);
	assert.ok(stripped.includes(`"http://x"`), "字符串字面量应原样保留");
	assert.ok(!stripped.includes("尾注释"), "行注释应被剥离");
	assert.ok(!stripped.includes("块"), "块注释应被剥离");
	assert.ok(stripped.includes("int32 A;"), "注释后代码应保留");
});

test("注释里的伪声明不会被提取", () => {
	const { classes } = parseFixture();
	const widget = mustFind(classes, "AZzWidget");
	assert.ok(
		widget.properties.every((p) => !p.type.includes("UFakeFrom")),
		"注释中的 UPROPERTY 不应进入属性列表",
	);
});

// ████████████████████████████████████████████████████████████████████████████
//  类识别与文档挂载
// ████████████████████████████████████████████████████████████████████████████

test("五种反射类型全部识别且 kind 正确", () => {
	const { classes } = parseFixture();
	assert.equal(mustFind(classes, "AZzWidget").kind, "uactor");
	assert.equal(mustFind(classes, "UZzComponent").kind, "ucomponent");
	assert.equal(mustFind(classes, "FZzStat").kind, "ustruct");
	assert.equal(mustFind(classes, "EZzState").kind, "uenum");
	assert.equal(mustFind(classes, "IZzAble").kind, "uinterface");
});

test("头文件辅助类型同时收纳纯 C++、USTRUCT 与 UENUM，且不重复当前类型", () => {
	const { classes } = parseFixture();
	const declarations = mustFind(classes, "AZzWidget").cppDeclarations;
	assert.deepEqual(declarations.map((entry) => `${entry.kind}:${entry.name}`), [
		"class:FZzPlainHelper",
		"struct:FZzPlainPayload",
		"enum:EZzPlainMode",
		"struct:FZzStat",
		"enum:EZzState",
	]);
	assert.deepEqual(declarations[0].bases, ["FZzPlainBase"]);
	assert.equal(declarations[0].description, "头文件级纯 C++ 辅助类。");
	assert.deepEqual(declarations.slice(-2).map((entry) => entry.reflection), ["USTRUCT", "UENUM"]);
	assert.ok(!declarations.some((entry) => entry.name === "AZzWidget"));
	assert.ok(!declarations.some((entry) => entry.name === "FZzForwardOnly" || entry.name === "FNestedDetail" || entry.name === "FCommentOnly"));
	// 辅助区归属规则（F31b）：兄弟声明只挂主类——值类型/纯 C++ 提升类型的 Spec 不再
	// "残留"同头文件的全部同伴（曾致每个 F/E 类型点开都带上一层的辅助类区）
	assert.deepEqual(mustFind(classes, "FZzStat").cppDeclarations, [], "USTRUCT 值类型不携带兄弟声明");
	assert.deepEqual(mustFind(classes, "EZzState").cppDeclarations, [], "UENUM 值类型不携带兄弟声明");
});

test("includePlainCpp 将纯 C++ 辅助定义提升为同构 Spec，并保留函数与数据成员", () => {
	const { dir } = parseFixture();
	const classes = parseHeader(join(dir, "ZzWidget.h"), dir, { includePlainCpp: true });
	const helper = mustFind(classes, "FZzPlainHelper");
	assert.deepEqual(helper.cppDeclarations, [], "提升的纯 C++ 类型不携带兄弟声明（归属规则）");
	const payload = mustFind(classes, "FZzPlainPayload");
	const mode = mustFind(classes, "EZzPlainMode");
	assert.equal(helper.kind, "ustruct");
	assert.equal(helper.declarationKind, "class");
	assert.equal(payload.declarationKind, "struct");
	assert.equal(mode.declarationKind, "enum");
	assert.deepEqual(helper.tags, ["cpp_only"]);
	assert.deepEqual(payload.properties.map(({ name, type }) => ({ name, type })), [{ name: "Count", type: "int32" }]);
	assert.deepEqual(mode.properties.map((entry) => entry.name), ["First", "Second"]);
});

test("doc 注释块按位置挂载为 description，UCLASS 标签解析", () => {
	const { classes } = parseFixture();
	const widget = mustFind(classes, "AZzWidget");
	assert.equal(widget.description, "Zz 武器角色。");
	assert.deepEqual(widget.tags.sort(), ["abstract", "blueprintable"]);
	assert.deepEqual(widget.bases, ["AActor"]);
	assert.deepEqual(widget.interfaces, ["IZzAble"]);
});

// ████████████████████████████████████████████████████████████████████████████
//  UPROPERTY 持有语义
// ████████████████████████████████████████████████████████████████████████████

test("UPROPERTY 持有语义映射：composes / aggregates / depends_on / 位域", () => {
	const { classes } = parseFixture();
	const props = new Map(mustFind(classes, "AZzWidget").properties.map((p) => [p.name, p]));

	assert.deepEqual(props.get("Comp"), {
		name: "Comp", type: "TObjectPtr<UZzComponent>", targetClass: "UZzComponent", relation: "composes",
	});
	assert.equal(props.get("Items")?.targetClass, "UZzItem");
	assert.equal(props.get("Items")?.relation, "aggregates");
	assert.equal(props.get("BossRef")?.targetClass, "AZzBoss");
	assert.equal(props.get("BossRef")?.relation, "aggregates");
	assert.equal(props.get("ProjectileClass")?.targetClass, "AZzProjectile");
	assert.equal(props.get("ProjectileClass")?.relation, "depends_on");
	// 位域回归：uint8 bArmed : 1 的成员名是 bArmed 而非 "1"
	assert.equal(props.get("bArmed")?.type, "uint8");
	assert.equal(props.get("bReplicated")?.type, "bool", "RetVal delegate 的 bool 返回类型不能污染普通 bool 成员分类");
	assert.ok(!props.has("1"), "位域位宽不应成为成员名");
});

test("委托成员：UPROPERTY 委托与裸委托都归入 delegates 而非 properties", () => {
	const { classes } = parseFixture();
	const widget = mustFind(classes, "AZzWidget");
	const members = widget.delegates.map((d) => d.member).sort();
	assert.deepEqual(members, ["OnFired", "OnFiredBare"]);
	assert.ok(widget.delegates.every((d) => d.type === "FOnZzFired"));
	assert.ok(!widget.properties.some((p) => p.type === "FOnZzFired"), "委托不应重复进属性");
	assert.ok(!widget.delegates.some((delegate) => delegate.member === "bReplicated" || delegate.type === "bool"));
	assert.deepEqual(mustFind(classes, "UZzComponent").delegates, [{ member: "OnChanged", type: "FOnZzFired" }], "GENERATED_BODY 后的首个裸委托也必须识别");
});

// ████████████████████████████████████████████████████████████████████████████
//  函数声明
// ████████████████████████████████████████████████████████████████████████████

test("函数解析：UFUNCTION 元数据、访问标签截断、内联体压平、匿名参数", () => {
	const { classes } = parseFixture();
	const widget = mustFind(classes, "AZzWidget");
	const fns = new Map(widget.functions.map((f) => [f.name, f]));

	// 历史回归：访问标签等长替换为 ';'，函数声明正则不得跨标签吞并
	assert.deepEqual(
		[...fns.keys()].sort(),
		["BeginPlay", "DoAttack", "GetCachedValue", "HandleCompChanged", "MakeWidget", "OnZz", "SetRatio", "Value"],
		"函数集合应精确匹配（构造/析构/纯虚接口方法不入列，也不得出现跨标签垃圾项）",
	);

	const attack = fns.get("DoAttack")!;
	assert.equal(attack.hasUFunction, true);
	assert.equal(attack.blueprintExposable, true);
	assert.equal(attack.category, "Zz|Combat");
	assert.equal(attack.description, "攻击入口。");
	assert.deepEqual(attack.params, [
		{ name: "Power", type: "int32" },
		{ name: "bQueued", type: "bool" },
	]);

	assert.equal(fns.get("BeginPlay")?.isOverride, true);
	assert.equal(fns.get("Value")?.isConst, true);
	assert.equal(fns.get("MakeWidget")?.isStatic, true);
	assert.equal(fns.get("MakeWidget")?.signature, "static AZzWidget* MakeWidget()");
	// 匿名参数（引擎头文件合法写法）：name 允许空串
	assert.deepEqual(fns.get("SetRatio")?.params, [{ name: "", type: "float" }]);
	// 内联函数体压平后仍可发现声明
	assert.equal(fns.get("GetCachedValue")?.returnType, "int32");
	assert.deepEqual(mustFind(classes, "IZzAble").functions.map((fn) => fn.name), ["OnZz"]);
});

// ████████████████████████████████████████████████████████████████████████████
//  .cpp 成员使用
// ████████████████████████████████████████████████████████████████████████████

test("parseCppMemberUsage：函数体 → 使用的持有成员", () => {
	const { classes, dir } = parseFixture();
	const widget = mustFind(classes, "AZzWidget");
	const usage = parseCppMemberUsage(join(dir, "ZzWidget.cpp"), widget);
	assert.deepEqual([...(usage.get("DoAttack") ?? [])].sort(), ["Comp", "bArmed"]);
	assert.deepEqual([...(usage.get("BeginPlay") ?? [])].sort(), ["Comp", "Items"]);
});

test("parseCppDelegateBindings：从持有对象 Add/Bind 行为提取订阅与响应函数", () => {
	const { classes, dir } = parseFixture();
	const widget = mustFind(classes, "AZzWidget");
	assert.deepEqual(parseCppDelegateBindings(join(dir, "ZzWidget.cpp"), widget), [{
		sourceFunction: "BeginPlay",
		ownerMember: "Comp",
		ownerClass: "UZzComponent",
		delegateMember: "OnChanged",
		operation: "AddUObject",
		handler: "HandleCompChanged",
	}]);
});

test("完整提取把接口实现、委托订阅和响应函数转成可布局图事实", () => {
	const { dir } = parseFixture();
	const graph = extractClassGraph([dir], { withEngine: false, subsystem: "delegate-semantics" });
	const provenance = graph.meta.provenance as { status?: string; fingerprint?: { algorithm?: string; file_count?: number } };
	const coverage = graph.meta.coverage as { status?: string; discovered_files?: number; consumed_files?: number; skipped_files?: number; failed_files?: number };
	assert.equal(graph.meta.format_version, 2);
	assert.equal(provenance.status, "verified");
	assert.equal(provenance.fingerprint?.algorithm, "sha256-path-content-v1");
	assert.equal(provenance.fingerprint?.file_count, 2);
	assert.deepEqual(coverage, { status: "complete", discovered_files: 2, consumed_files: 2, skipped_files: 0, failed_files: 0, diagnostics: [] });
	const nodes = graph.elements.nodes.map((node) => node.data as Record<string, unknown>);
	const widget = nodes.find((node) => node.id === "AZzWidget");
	assert.deepEqual(widget?.data_members, [
		{ name: "Comp", type: "TObjectPtr<UZzComponent>" },
		{ name: "Items", type: "TArray<TObjectPtr<UZzItem>>" },
		{ name: "BossRef", type: "TWeakObjectPtr<AZzBoss>" },
		{ name: "ProjectileClass", type: "TSubclassOf<AZzProjectile>" },
		{ name: "bArmed", type: "uint8" },
		{ name: "bReplicated", type: "bool" },
	]);
	assert.deepEqual(widget?.delegate_subscriptions, [{
		sourceFunction: "BeginPlay",
		ownerMember: "Comp",
		ownerClass: "UZzComponent",
		delegateMember: "OnChanged",
		operation: "AddUObject",
		handler: "HandleCompChanged",
		delegateType: "FOnZzFired",
	}]);
	assert.deepEqual(nodes.find((node) => node.id === "AZzWidget::OnZz")?.tags, ["override", "interface:IZzAble"]);
	assert.deepEqual(nodes.find((node) => node.id === "AZzWidget::HandleCompChanged")?.tags, ["delegate_response"]);
});

test("guessTypeByName 前缀启发式", () => {
	assert.equal(guessTypeByName("AFoo"), "uactor");
	assert.equal(guessTypeByName("UFooComponent"), "ucomponent");
	assert.equal(guessTypeByName("IFoo"), "uinterface");
	assert.equal(guessTypeByName("FFoo"), "ustruct");
	assert.equal(guessTypeByName("EFoo"), "uenum");
	assert.equal(guessTypeByName("SFooWidget"), "uclass");
	assert.equal(guessTypeByName("UFoo"), "uclass");
});

test("命名空间枚举 namespace EXxx { enum Type }：以命名空间名为身份，不产出裸 Type 节点", () => {
	// KismetSystemLibrary 等大量引擎头文件用 UE 老式命名空间枚举；裸 Type 过不了
	// E 前缀命名门禁，按需解析被拒 → Spec 打开为空（用户在多个类中看到 Type 节点）
	const dir = mkdtempSync(join(tmpdir(), "graphbrain-nsenum-"));
	writeFileSync(join(dir, "ZzTrace.h"), `#pragma once

/** 调试绘制的持续时长语义。 */
namespace EZzDrawDebugTrace
{
	enum Type
	{
		None,
		ForOneFrame,
		ForDuration,
		Persistent
	};
}

namespace ZzOuter
{
	namespace EZzNested
	{
		enum Type { A, B };
	}
}

// 无命名空间的裸 Type：不是可命名的 API 身份，应被丢弃
enum Type { Loose };

enum class EZzNormal : uint8 { X, Y };
`, "utf8");
	const classes = parseHeader(join(dir, "ZzTrace.h"), dir, { includePlainCpp: true });
	const names = classes.map((cls) => cls.name);
	assert.ok(!names.includes("Type"), `不得出现裸 Type 节点，实际: ${names.join(", ")}`);

	const trace = mustFind(classes, "EZzDrawDebugTrace");
	assert.equal(trace.kind, "uenum");
	assert.equal(trace.declarationKind, "enum");
	assert.deepEqual(trace.properties.map((entry) => entry.name), ["None", "ForOneFrame", "ForDuration", "Persistent"]);
	assert.equal(trace.description, "调试绘制的持续时长语义。", "枚举无独立 doc 时应回退到命名空间的 doc");

	// 嵌套命名空间取最内层名
	const nested = mustFind(classes, "EZzNested");
	assert.deepEqual(nested.properties.map((entry) => entry.name), ["A", "B"]);

	// 常规 enum class 不受影响
	mustFind(classes, "EZzNormal");
});

test("枚举值成员解析：UENUM 反射枚举补全值列表，显式初始值捕获，UMETA 剥离", () => {
	// 反射枚举曾一直是空 properties——Spec 打开无内容，与类/struct 的成员节点视觉语言不一致
	const dir = mkdtempSync(join(tmpdir(), "graphbrain-enumvals-"));
	writeFileSync(join(dir, "ZzEnums.h"), `#pragma once

UENUM(BlueprintType)
enum class EZzWeaponSlot : uint8
{
	Primary = 0 UMETA(DisplayName = "主武器"),
	Secondary UMETA(DisplayName = "副武器"),
	Melee = 1 << 3,
};

UENUM()
namespace EZzLegacyMode
{
	enum Type
	{
		Off,
		On = 5,
	};
}

enum class EZzPlain : uint8 { A, B = 2 };
`, "utf8");
	const classes = parseHeader(join(dir, "ZzEnums.h"), dir, { includePlainCpp: true });

	const slot = mustFind(classes, "EZzWeaponSlot");
	assert.equal(slot.kind, "uenum");
	assert.deepEqual(
		slot.properties.map(({ name, type }) => ({ name, type })),
		[
			{ name: "Primary", type: "0" },
			{ name: "Secondary", type: "" },
			{ name: "Melee", type: "1 << 3" },
		],
		"UMETA 必须剥离；type 承载显式初始值，无值为空串",
	);

	// 老式反射命名空间枚举同样有值列表
	const legacy = mustFind(classes, "EZzLegacyMode");
	assert.deepEqual(legacy.properties.map(({ name, type }) => ({ name, type })), [
		{ name: "Off", type: "" },
		{ name: "On", type: "5" },
	]);

	// 纯 C++ 枚举（includePlainCpp 提升路径）同样捕获显式值
	const plain = mustFind(classes, "EZzPlain");
	assert.deepEqual(plain.properties.map(({ name, type }) => ({ name, type })), [
		{ name: "A", type: "" },
		{ name: "B", type: "2" },
	]);
});

test("反射宏误关联防护：#define 内的宏不算使用点，越窗/enum class 不绑定，UE_DEPRECATED 不当枚举名", () => {
	// ObjectMacros.h 定义 UCLASS 宏本身曾被当使用点，向后无界扫描把 enum class 抓成 UCLASS 类
	const dir = mkdtempSync(join(tmpdir(), "graphbrain-macroguard-"));
	writeFileSync(join(dir, "ZzMacros.h"), `#pragma once

#define UCLASS(...) BODY_MACRO_COMBINE(CURRENT_FILE_ID,_,__LINE__,_PROLOG)
#define USTRUCT(...) \\
	BODY_MACRO_COMBINE(CURRENT_FILE_ID,_,__LINE__,_GENERATED_BODY)

/** 正常反射类不受防护误伤。 */
UCLASS(BlueprintType)
class ZZ_API AZzGuarded : public AActor
{
	GENERATED_BODY()
};

/** 二段构造相位。 */
enum class EZzConstructPhase : uint8
{
	Phase0,
	Outer,
};

enum class UE_DEPRECATED(5.5, "Use EZzNew") EZzOldThing : uint8 { A, B };

template <typename T>
class TZzWrapper
{
public:
	class TIterator { int32 Cursor; };
};
`, "utf8");
	const classes = parseHeader(join(dir, "ZzMacros.h"), dir, { includePlainCpp: true });
	const names = classes.map((cls) => cls.name);
	// 宏定义行的 UCLASS/USTRUCT 不得把 enum class 抓成反射类
	const phases = classes.filter((cls) => cls.name === "EZzConstructPhase");
	assert.equal(phases.length, 1, `EZzConstructPhase 只应有一个实体，实际 ${phases.length}: ${names.join(", ")}`);
	assert.equal(phases[0].kind, "uenum");
	// 正常反射类不受误伤
	assert.equal(mustFind(classes, "AZzGuarded").kind, "uactor");
	// UE_DEPRECATED 宏名不得被当成枚举名；被弃用枚举保留真实名字
	assert.ok(!names.includes("UE_DEPRECATED"), `UE_DEPRECATED 被当成了类型名: ${names.join(", ")}`);
	mustFind(classes, "EZzOldThing");
	// 文件级模板类型不入目录，且其内部类型不得漏出
	assert.ok(!names.includes("TZzWrapper"), "模板类型不应入目录");
	assert.ok(!names.includes("TIterator"), "模板内部类型不得漏出为独立声明");
});

// 夹具目录留给操作系统临时目录清理策略；单测进程内不复用，无需显式删除。
// （Windows 上删临时目录偶发 EBUSY，与被测逻辑无关，不让它闪断测试。）

test("UPROPERTY default values containing semicolons are parsed without truncation", () => {
	const dir = mkdtempSync(join(tmpdir(), "graphbrain-semiprop-"));
	const header = `#pragma once
#include "CoreMinimal.h"
#include "UObject/Object.h"
#include "ZzSemiProp.generated.h"

UCLASS()
class ZZSEMIPROP_API UZzSemiProp : public UObject
{
	GENERATED_BODY()
public:
	// 默认值字符串内含分号：旧实现按第一个分号截断，会丢后续属性。
	UPROPERTY() FText Label = NSLOCTEXT("Zz", "Key", "x; y");
	UPROPERTY() FString Name = TEXT("a;b;c");
	UPROPERTY() int32 Count = 3;
};
`;
	writeFileSync(join(dir, "ZzSemiProp.h"), header, "utf8");
	const classes = parseHeader(join(dir, "ZzSemiProp.h"), dir);
	const cls = classes.find((item) => item.name === "UZzSemiProp");
	assert.ok(cls, "UZzSemiProp 应被解析");
	const props = cls!.properties;
	assert.equal(props.length, 3, `三个属性都应完整解析，实际 ${props.length}: ${props.map((p) => p.name).join(", ")}`);
	assert.deepEqual(props.map((p) => p.name), ["Label", "Name", "Count"]);
});
