import { UploadFiles } from 'express'
import { Transaction } from 'sequelize/types'
import { DEFAULT_AUDIO_RESOLUTION, JOB_PRIORITY } from '@server/initializers/constants'
import { TagModel } from '@server/models/video/tag'
import { VideoModel } from '@server/models/video/video'
import { VideoJobInfoModel } from '@server/models/video/video-job-info'
import { FilteredModelAttributes } from '@server/types'
import { MThumbnail, MUserId, MVideoFile, MVideoTag, MVideoThumbnail, MVideoUUID } from '@server/types/models'
import { ThumbnailType, VideoCreate, VideoPrivacy, VideoTranscodingPayload } from '@shared/models'
import { CreateJobOptions, JobQueue } from './job-queue/job-queue'
import { updateVideoMiniatureFromExisting } from './thumbnail'
import { CONFIG } from '@server/initializers/config'

function buildLocalVideoFromReq (videoInfo: VideoCreate, channelId: number): FilteredModelAttributes<VideoModel> {
  return {
    name: videoInfo.name,
    remote: false,
    category: videoInfo.category,
    licence: videoInfo.licence ?? CONFIG.DEFAULTS.PUBLISH.LICENCE,
    language: videoInfo.language,
    commentsEnabled: videoInfo.commentsEnabled ?? CONFIG.DEFAULTS.PUBLISH.COMMENTS_ENABLED,
    downloadEnabled: videoInfo.downloadEnabled ?? CONFIG.DEFAULTS.PUBLISH.DOWNLOAD_ENABLED,
    waitTranscoding: videoInfo.waitTranscoding || false,
    nsfw: videoInfo.nsfw || false,
    description: videoInfo.description,
    support: videoInfo.support,
    privacy: videoInfo.privacy || VideoPrivacy.PRIVATE,
    channelId: channelId,
    originallyPublishedAt: videoInfo.originallyPublishedAt
      ? new Date(videoInfo.originallyPublishedAt)
      : null
  }
}

async function buildVideoThumbnailsFromReq (options: {
  video: MVideoThumbnail
  files: UploadFiles
  fallback: (type: ThumbnailType) => Promise<MThumbnail>
  automaticallyGenerated?: boolean
}) {
  const { video, files, fallback, automaticallyGenerated } = options

  const promises = [
    {
      type: ThumbnailType.MINIATURE,
      fieldName: 'thumbnailfile'
    },
    {
      type: ThumbnailType.PREVIEW,
      fieldName: 'previewfile'
    }
  ].map(p => {
    const fields = files?.[p.fieldName]

    if (fields) {
      return updateVideoMiniatureFromExisting({
        inputPath: fields[0].path,
        video,
        type: p.type,
        automaticallyGenerated: automaticallyGenerated || false
      })
    }

    return fallback(p.type)
  })

  return Promise.all(promises)
}

async function setVideoTags (options: {
  video: MVideoTag
  tags: string[]
  transaction?: Transaction
}) {
  const { video, tags, transaction } = options

  const internalTags = tags || []
  const tagInstances = await TagModel.findOrCreateTags(internalTags, transaction)

  await video.$set('Tags', tagInstances, { transaction })
  video.Tags = tagInstances
}

async function addOptimizeOrMergeAudioJob (video: MVideoUUID, videoFile: MVideoFile, user: MUserId) {
  let dataInput: VideoTranscodingPayload

  if (videoFile.isAudio()) {
    dataInput = {
      type: 'merge-audio-to-webtorrent',
      resolution: DEFAULT_AUDIO_RESOLUTION,
      videoUUID: video.uuid,
      isNewVideo: true
    }
  } else {
    dataInput = {
      type: 'optimize-to-webtorrent',
      videoUUID: video.uuid,
      isNewVideo: true
    }
  }

  const jobOptions = {
    priority: await getTranscodingJobPriority(user)
  }

  return addTranscodingJob(dataInput, jobOptions)
}

async function addTranscodingJob (payload: VideoTranscodingPayload, options: CreateJobOptions = {}) {
  await VideoJobInfoModel.increaseOrCreate(payload.videoUUID, 'pendingTranscode')

  return JobQueue.Instance.createJobWithPromise({ type: 'video-transcoding', payload: payload }, options)
}

async function addMoveToObjectStorageJob (video: MVideoUUID, isNewVideo = true) {
  await VideoJobInfoModel.increaseOrCreate(video.uuid, 'pendingMove')

  const dataInput = { videoUUID: video.uuid, isNewVideo }
  return JobQueue.Instance.createJobWithPromise({ type: 'move-to-object-storage', payload: dataInput })
}

async function getTranscodingJobPriority (user: MUserId) {
  const now = new Date()
  const lastWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7)

  const videoUploadedByUser = await VideoModel.countVideosUploadedByUserSince(user.id, lastWeek)

  return JOB_PRIORITY.TRANSCODING + videoUploadedByUser
}

// ---------------------------------------------------------------------------

export {
  buildLocalVideoFromReq,
  buildVideoThumbnailsFromReq,
  setVideoTags,
  addOptimizeOrMergeAudioJob,
  addTranscodingJob,
  addMoveToObjectStorageJob,
  getTranscodingJobPriority
}
