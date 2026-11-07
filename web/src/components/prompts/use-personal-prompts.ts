import { useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { getPersonalPromptsRevision, readPersonalPrompts, subscribePersonalPrompts } from "@/services/personal-prompts";

export function usePersonalPromptsRevision() {
    return useSyncExternalStore(subscribePersonalPrompts, getPersonalPromptsRevision, getPersonalPromptsRevision);
}
export function usePersonalPrompts() {
    const revision = usePersonalPromptsRevision();
    return useQuery({ queryKey: ["personal-prompts", revision], queryFn: readPersonalPrompts });
}
