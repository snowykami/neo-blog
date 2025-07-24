import type { Label } from "@/models/label";
import type { BaseResponse } from "@/models/resp";
import axiosClient from "./client";


export async function listLabels(): Promise<BaseResponse<Label[]>> {
    const res = await axiosClient.get<BaseResponse<Label[]>>("/label/list", {
    });
    return res.data;
}