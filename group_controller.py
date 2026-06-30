class BroadcastTargetGroup:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "target_group": (["No Valid Target Groups"],),
                "current_seed": ("INT", {"default": 0, "min": 0, "max": 0xffffffffffffffff}),
                "lock_seed": ("BOOLEAN", {"default": False, "label_on": "Locked", "label_off": "Random"}),
                "master_prompt": ("STRING", {"multiline": True, "default": ""})
            }
        }

    @classmethod
    def VALIDATE_INPUTS(cls, **kwargs):
        return True

    RETURN_TYPES = ()
    FUNCTION = "noop"
    CATEGORY = "Utility"
    OUTPUT_NODE = True

    def noop(self, **kwargs):
        return {}


class BroadcastedPrompt:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "text": ("STRING", {"multiline": True, "default": ""})
            }
        }
    RETURN_TYPES = ("STRING",)
    FUNCTION = "process"
    CATEGORY = "Utility"

    def process(self, text):
        return (text,)


class BroadcastedSeed:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "int_value": ("INT", {"default": 0, "min": 0, "max": 0xffffffffffffffff}) 
            }
        }
    RETURN_TYPES = ("INT",)
    FUNCTION = "process"
    CATEGORY = "Utility"

    def process(self, int_value):
        return (int_value,)