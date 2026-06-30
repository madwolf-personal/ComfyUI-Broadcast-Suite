from .group_controller import BroadcastTargetGroup, BroadcastedPrompt, BroadcastedSeed

NODE_CLASS_MAPPINGS = {
    "BroadcastTargetGroup": BroadcastTargetGroup,
    "BroadcastedPrompt": BroadcastedPrompt,
    "BroadcastedSeed": BroadcastedSeed,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "BroadcastTargetGroup": "Broadcast Target Group",
    "BroadcastedPrompt": "Broadcasted Prompt",
    "BroadcastedSeed": "Broadcasted Seed",
}

WEB_DIRECTORY = "./web/js"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]