---
title: How It's Done
subtitle: Vibecoding Sirius Reborn
---

# 99% Vibecoded

Yes, you read that right. The entire game from beginning to end is 99% coded by Claude Code (only).
Multiple agents on both my PCs run all day doing what I tell them to do and to put in the game.

## "So you didn't do anything?"

People have a completely wrong understanding of what AI actually does. It is a force multiplier, it cannot replace you.

I can't write "build freelancer" into it. It's much more granular.

Trust me, because I tried.

When I first set out to do this thing I told the (at the time Grok bot):
> Look into the game files of <freelancer install> and recreate the New York system in Unreal Engine.

Sounds good. And it did.

But the more I built on top of it, it actually did literally just that. Taking the old way of doing things and putting it in Unreal.

The nebulas were just blobs instead of actually foggy, dynamic renders. The asteroids were just lowpoly rocks placed in the middle of nowhere.
No actual light rendering.

In fact, the more I worked on this, the more I realized I actually have to do the whole thing from scratch.

So this whole thing of "just do X" in a prompt isn't really working. Not yet, anyway.

## How I do it

So what I learned along the way is the following:
1. Claude Code is lightyears ahead of others. Turns out having an AI specialized in something makes it really good at it
2. The prompt is VERY important. It doesn't have to be verbose, but the clearer you describe, the better
3. "Godprompts" are a meme. People talk about sending one massive prompt and then the Agent does everything over night are bullshitting you. The more tasks the Agent has to go through, the sloppier they become, or the more details they miss. Granular, clear prompts work best (like "pull the data for all guns into Unreal Engine" and then do the graphics, VFX, and sound in another one).
4. Code peak. Visuals nah. AI is amazing, truly amazing, at writing code at this point. But when it comes to creating visually appealing things from thin air, they suck badly. I had it try build ships or stations. Nightmares. So you need:
5. The AI Chain. I have an idea, I put that into an image creator and sift through 20 shitty ones to finally get the good one. Have the other AI upscale, clean it, and create multiple views of it. Have the third AI create a 3D model of the image. Clean the model, THEN put it in game.

You can already tell at this point that this isn't just sending one prompt and it's all done. It's a lot of work. 
The beauty of it though (especially as a programmer on my 9-5) is, that it takes the tedious stuff away from you.
You can focus on the vision, story, visuals, what it's supposed to be, and the AI puts it into the engine.

## Limits of AI (for now)

- I already mentioned the nightmares it created when I let gen AI create ships and stations (in images or ingame).
So anything visual it really struggles with. So it REALLY depends on the source material. The better and more precise the source image is, the better the 3D model will be.
- Self-serving. I needed to set clear rules on what I want and what to do in .md files in the repo so the AI knows every time it does something which direction to go. In the end, you are basically the leader of a small team and they need to know the direction at all times.
- Context. This is what's basically the length of your chat window. How much the AI has already done in this chat. It can be cleared and compacted, but you are still better off starting a new chat after each bigger task. Hence the documents mentioned above.

After all, it's still an early tech, but what it can already achieve is mind blowing.

This is where I love this tech mostly.

I always had ideas for things in games, but I could NEVER do them because it was so much work, and took years of even just understanding it.
Now, creative people with ideas can bring them to live a lot easier and faster. Maybe not perfect, but at least they can do it at all.

The only people hating on this are the ones who never had any creativity at all and just fear being replaced.
