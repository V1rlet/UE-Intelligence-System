# Curated reference annotation review

> Status: archived, awaiting explicit semantic-owner review. Nothing in this document has been written to CGS specifications.

Source: `data/reading-context/ue5_code.json` revision 2.

## ann_ref_008

- Legacy subsystem: `framework-reference`
- Stable target at capture: `ACharacter`
- Type: `gotcha`
- Source hash: `93c2fb0f2be9a9412a0991356323d2d37f8333b5`

CharacterMovementComponent 自带客户端预测与服务器校正。自定义移动（冲刺、滑铲）优先扩展 CMC（自定义 MovementMode / RootMotionSource），自写 SetActorLocation 位移会破坏网络预测。

## ann_ref_001

- Legacy subsystem: `framework-reference`
- Stable target at capture: `AGameModeBase`
- Type: `gotcha`
- Source hash: `1762ee0d645d8a5284610f291dabe456b2cd55a0`

客户端上不存在 GameMode——客户端代码里 GetGameMode() 拿到的是 nullptr（单机/监听服务器本机除外）。客户端要查规则状态，走 GameState。

## ann_ref_002

- Legacy subsystem: `framework-reference`
- Stable target at capture: `AGameModeBase`
- Type: `best_practice`
- Source hash: `1762ee0d645d8a5284610f291dabe456b2cd55a0`

规则、胜负判定、玩家生成逻辑放这里；但会话级数据（玩家档案、跨局统计）不要放——切图时 GameMode 会销毁重建，跨关卡数据的归宿是 GameInstance / GameInstanceSubsystem。

## ann_ref_003

- Legacy subsystem: `framework-reference`
- Stable target at capture: `AGameStateBase`
- Type: `best_practice`
- Source hash: `e1741be7821c8227859314bae26f287019d21495`

想让所有端都看到的比赛数据（剩余时间、比分、阶段）放这里并标记 Replicated；GameMode 算出来的结果通过 GameState 广播，这是引擎规定的"服务器算、全端看"分工。

## ann_ref_007

- Legacy subsystem: `framework-reference`
- Stable target at capture: `APawn`
- Type: `best_practice`
- Source hash: `44c41246e3da6a668c0baa3810cb076817cc1cd9`

Pawn 是"身体"：设计上允许被销毁、重生、换乘（载具）。任何需要跨越死亡存续的数据都不属于 Pawn——放 PlayerState（公开）或 PC（私有）。

## ann_ref_004

- Legacy subsystem: `framework-reference`
- Stable target at capture: `APlayerController`
- Type: `best_practice`
- Source hash: `55634503a45d8620107ec89373956d4d2ecf8cbe`

职责分界：输入路由与 UI 归 PlayerController，gameplay 能力归 Pawn。Pawn 会死亡重生，PC 全程常驻——放错位置的逻辑会在重生时丢失或悬空。

## ann_ref_005

- Legacy subsystem: `framework-reference`
- Stable target at capture: `APlayerController`
- Type: `gotcha`
- Source hash: `55634503a45d8620107ec89373956d4d2ecf8cbe`

PC 的 BeginPlay 时未必已经 Possess 到 Pawn（多人时序不保证）。依赖 Pawn 的初始化写在 OnPossess / OnRep_Pawn，不要写在 BeginPlay。

## ann_ref_006

- Legacy subsystem: `framework-reference`
- Stable target at capture: `APlayerState`
- Type: `best_practice`
- Source hash: `5a648594ecc8a03597c5912acbaa371e2a5b3064`

玩家的公开状态（名字、分数、队伍）放 PlayerState：它复制到所有端。PlayerController 只存在于服务器和拥有端，放在 PC 上的数据别的玩家永远看不到。

## ann_ref_012

- Legacy subsystem: `framework-reference`
- Stable target at capture: `lifecycle:PostLogin`
- Type: `best_practice`
- Source hash: `not recorded`

多人加入流程的服务器挂点：PostLogin 时 PlayerController 已就绪、PlayerState 已入 PlayerArray，适合在这里做队伍分配与初始化 RPC。更早的 PreLogin 只适合做准入校验。

## ann_ref_009

- Legacy subsystem: `framework-reference`
- Stable target at capture: `UGameInstance`
- Type: `gotcha`
- Source hash: `19a6de71ee2cac9e7d3d99493d7fc99cb6a5a706`

不要在 GameInstance 里缓存 World 内对象（Actor/Component）的强引用——切图后 World 销毁，引用悬空。需要跨图传递的用数据（struct/id），进新图后重新解析。

## ann_ref_010

- Legacy subsystem: `framework-reference`
- Stable target at capture: `UGameInstance`
- Type: `best_practice`
- Source hash: `19a6de71ee2cac9e7d3d99493d7fc99cb6a5a706`

跨关卡存续的服务（存档、账号、匹配）用 UGameInstanceSubsystem，不要手写单例：Subsystem 由引擎管理生命周期、自动实例化、蓝图可直取。

## ann_ref_011

- Legacy subsystem: `framework-reference`
- Stable target at capture: `UUserWidget`
- Type: `best_practice`
- Source hash: `8ff1d3504ff9ef9df92512a77beecf4cdf5e5f0a`

CreateWidget 的 Owner 传 PlayerController；UI 逻辑不进 GameMode（服务器上没有 UI，专用服务器构建里这类代码是死代码或崩溃点）。

## ann_gf_gamemode

- Legacy subsystem: `gameplay-framework-reference`
- Stable target at capture: `AGameModeBase`
- Type: `gotcha`
- Source hash: `not recorded`

GameMode 只存在于服务器；客户端规则展示必须读取 GameState。

## ann_gf_pawn

- Legacy subsystem: `gameplay-framework-reference`
- Stable target at capture: `APawn`
- Type: `gotcha`
- Source hash: `not recorded`

Pawn 是可替换身体；跨重生数据应进入 PlayerState 或其他更长生命周期作用域。

## ann_gf_pc

- Legacy subsystem: `gameplay-framework-reference`
- Stable target at capture: `APlayerController`
- Type: `best_practice`
- Source hash: `not recorded`

PlayerController 只存在于服务器和拥有端；不要把所有玩家都要看到的数据放在这里。

## ann_lyra_ps

- Legacy subsystem: `lyra-architecture-reference`
- Stable target at capture: `ALyraPlayerState`
- Type: `best_practice`
- Source hash: `not recorded`

玩家 ASC 由 PlayerState 持有，OwnerActor=PlayerState，AvatarActor=当前 Pawn，因此可跨 Pawn 重生保留能力状态。

## ann_lyra_exp

- Legacy subsystem: `lyra-architecture-reference`
- Stable target at capture: `ULyraExperienceManagerComponent`
- Type: `best_practice`
- Source hash: `not recorded`

Experience 加载是异步装配过程；依赖插件、PawnData 或输入的系统应等待 ExperienceLoaded。

## ann_lyra_extension

- Legacy subsystem: `lyra-architecture-reference`
- Stable target at capture: `ULyraPawnExtensionComponent`
- Type: `gotcha`
- Source hash: `not recorded`

不要用 BeginPlay + Delay 猜依赖就绪；Lyra 使用 InitState 协调 PawnData、Controller、PlayerState 与 ASC。

## Review rule

A human must select a CGS `spec/` or engine-reference owner. Do not infer a destination or upgrade these observations into current source facts.
