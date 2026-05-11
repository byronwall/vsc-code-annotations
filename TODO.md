# Code Annotations TODO

- Add delete actions for saved annotations in the left sidebar
- Allow creating dedicated annotation lists where each is a different markdown file, show as groups in the sidebar
  - Add a plus icon to the side bar and prompt for a name
  - Allow user ot mark a group as active or command prompt to change active list
  - Do NOT force list choice when creating a new annotation
- Add a button to open the annotation file at the line for each item (as a butotn in the left sidebar for each row)
- Allow annotating a whole file without selecting all lines

## General

- Label the code block based on the file extension? I am seeing something like `typescriptreact` instead of `tsx`

## Sidebar

- Flag when a file was deleted or cannot be reached (red text color or something) -- will likely want to delete it, or possibly search for the code across the repo?
- Give a yellow text color (or some warning hue) that indicates the comment source code drifted

## Types - defer to later

- I'm not sure the annotation type is really useful? Maybe we ask for it after the note if the user wants to?
- Make annotation types configurable from settings.
