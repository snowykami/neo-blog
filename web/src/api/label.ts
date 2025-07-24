import type { Label } from "@/models/label";
import type { BaseResponse } from "@/models/resp";
import axiosClient from "./client";


export async function listLabels(): Promise<BaseResponse<Label[] | null>> {
    const res = await axiosClient.get<BaseResponse<Label[] | null>>("/label/list", {
    });
    return res.data;
}