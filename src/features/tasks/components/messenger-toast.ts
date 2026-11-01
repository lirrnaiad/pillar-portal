import { toast } from "sonner"

import { copyText, MESSENGER_COPIED, MESSENGER_HINT } from "../messenger"

/**
 * A success toast's **Copy for Messenger** action, offered whenever a slot's
 * member changes (the task form's create and edit, the reassign picker). A
 * copy that works toasts "Copied — paste it in Messenger."; one the browser
 * refuses shows the text to copy by hand, until it is closed.
 */
export function copyForMessengerAction(text: string) {
  return {
    action: {
      label: "Copy for Messenger",
      onClick: async () => {
        if (await copyText(text)) toast.success(MESSENGER_COPIED)
        else
          toast(MESSENGER_HINT, {
            description: text,
            duration: Infinity,
            closeButton: true,
          })
      },
    },
  }
}
