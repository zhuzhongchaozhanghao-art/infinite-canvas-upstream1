// 列表批量节点的纯逻辑:变量笛卡尔积、模板填充、并发调度。不依赖浏览器与宿主。

export type BatchVariable = { name: string; values: string[] };

/** 所有变量取值做笛卡尔积;空值忽略,无有效值的变量不参与;无变量时返回 [{}] */
export function expandCombinations(variables: BatchVariable[]): Record<string, string>[] {
    let combos: Record<string, string>[] = [{}];
    for (const variable of variables) {
        const name = variable.name.trim();
        const values = variable.values.map((value) => value.trim()).filter(Boolean);
        if (!name || !values.length) continue;
        combos = combos.flatMap((combo) => values.map((value) => ({ ...combo, [name]: value })));
    }
    return combos;
}

/** 用组合替换模板里的 {变量名};未定义的变量名保持原样 */
export function fillTemplate(template: string, combo: Record<string, string>): string {
    return template.replace(/\{([^{}]+)\}/g, (match, name: string) => (Object.prototype.hasOwnProperty.call(combo, name) ? combo[name] : match));
}

/** 结果节点标题:组合值以「 / 」连接 */
export function comboTitle(combo: Record<string, string>): string {
    return Object.values(combo).join(" / ");
}

/** 校验变量名:非空且不与已有变量重名;合法返回 null */
export function validateVariableName(name: string, existing: string[]): string | null {
    const trimmed = name.trim();
    if (!trimmed) return "变量名不能为空";
    if (existing.includes(trimmed)) return "变量名已存在";
    return null;
}

/** 最多 limit 个任务同时运行;单个任务的异常由任务自身处理,这里不中断其余任务 */
export async function runWithConcurrency(tasks: (() => Promise<unknown>)[], limit: number): Promise<void> {
    let next = 0;
    const worker = async () => {
        while (next < tasks.length) {
            const task = tasks[next++];
            try {
                await task();
            } catch {
                // 任务内部已记录失败,这里吞掉以免影响其他任务
            }
        }
    };
    await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), tasks.length) }, worker));
}
