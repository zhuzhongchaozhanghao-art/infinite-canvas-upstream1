import { useEffect, useState } from "react";
import { Button, Modal, Slider } from "antd";
import { RotateCcw, WandSparkles } from "lucide-react";
import { useTranslation } from "react-i18next";

export type CanvasImageAngleParams = {
    horizontalAngle: number;
    pitchAngle: number;
};

const defaultParams: CanvasImageAngleParams = {
    horizontalAngle: 0,
    pitchAngle: 0,
};

export function CanvasNodeAngleDialog({ dataUrl, open, onClose, onConfirm }: { dataUrl: string; open: boolean; onClose: () => void; onConfirm: (params: CanvasImageAngleParams) => void }) {
    const { t } = useTranslation();
    const [params, setParams] = useState(defaultParams);

    useEffect(() => {
        if (open) setParams(defaultParams);
    }, [dataUrl, open]);

    const update = <Key extends keyof CanvasImageAngleParams>(key: Key, value: CanvasImageAngleParams[Key]) => setParams((current) => ({ ...current, [key]: value }));

    return (
        <Modal title={null} open={open && Boolean(dataUrl)} onCancel={onClose} footer={null} width={760} centered destroyOnHidden>
            <div className="space-y-5">
                <div>
                    <h2 className="text-xl font-semibold">{t("canvas.editors.angleTitle")}</h2>
                    <p className="mt-1 text-sm opacity-60">{t("canvas.editors.angleDescription")}</p>
                </div>
                <div className="grid gap-6 md:grid-cols-[minmax(260px,1fr)_320px]">
                    <div className="grid min-h-[280px] place-items-center rounded-xl border p-4">
                        <img src={dataUrl} alt={t("canvas.editors.originalImage")} className="max-h-[260px] max-w-full object-contain" draggable={false} />
                    </div>
                    <div className="space-y-6 py-2">
                        <div className="space-y-1">
                            <AngleSlider label={t("canvas.editors.horizontal")} value={params.horizontalAngle} min={-60} max={60} step={1} onChange={(value) => update("horizontalAngle", value)} />
                            <div className="grid grid-cols-[88px_1fr_72px] gap-4"><span /><div className="flex justify-between text-[11px] opacity-50"><span>{t("canvas.editors.cameraLeft")}</span><span>{t("canvas.editors.cameraFront")}</span><span>{t("canvas.editors.cameraRight")}</span></div></div>
                        </div>
                        <div className="space-y-1">
                            <AngleSlider label={t("canvas.editors.pitch")} value={params.pitchAngle} min={-45} max={45} step={1} onChange={(value) => update("pitchAngle", value)} />
                            <div className="grid grid-cols-[88px_1fr_72px] gap-4"><span /><div className="flex justify-between text-[11px] opacity-50"><span>{t("canvas.editors.cameraLow")}</span><span>{t("canvas.editors.cameraLevel")}</span><span>{t("canvas.editors.cameraHigh")}</span></div></div>
                        </div>
                        <Button icon={<RotateCcw className="size-4" />} onClick={() => setParams(defaultParams)}>{t("canvas.editors.reset")}</Button>
                    </div>
                </div>
                <div className="flex justify-end">
                    <Button type="primary" size="large" icon={<WandSparkles className="size-4" />} onClick={() => onConfirm(params)}>
                        {t("canvas.editors.aiGenerate")}
                    </Button>
                </div>
            </div>
        </Modal>
    );
}

function AngleSlider({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void }) {
    return (
        <div className="grid grid-cols-[88px_1fr_72px] items-center gap-4">
            <span className="font-medium opacity-75">{label}</span>
            <Slider min={min} max={max} step={step} value={value} onChange={onChange} />
            <span className="whitespace-nowrap text-right font-semibold">
                {Number.isInteger(value) ? value : value.toFixed(1)}
                °
            </span>
        </div>
    );
}
