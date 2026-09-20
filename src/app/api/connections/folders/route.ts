import { createConnectionFolder, deleteConnectionFolder, listConnectionFolders, renameConnectionFolder } from "@/lib/store/metadata";
import { errorResponse } from "@/lib/api/respond";

// Folders that file the connection list; a connection names the one it sits in.
export async function GET() {
  return Response.json({ folders: listConnectionFolders() });
}

export async function POST(request: Request) {
  try {
    const { name } = (await request.json()) as { name?: unknown };
    return Response.json({ folders: createConnectionFolder(name) }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(request: Request) {
  try {
    const { from, to } = (await request.json()) as { from?: unknown; to?: unknown };
    return Response.json({ folders: renameConnectionFolder(from, to) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(request: Request) {
  try {
    const { name } = (await request.json()) as { name?: unknown };
    return Response.json({ folders: deleteConnectionFolder(name) });
  } catch (err) {
    return errorResponse(err);
  }
}
