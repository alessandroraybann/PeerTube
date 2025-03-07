import { SortMeta } from 'primeng/api'
import { from, Observable } from 'rxjs'
import { catchError, concatMap, map, switchMap, toArray } from 'rxjs/operators'
import { HttpClient, HttpParams, HttpRequest } from '@angular/common/http'
import { Injectable } from '@angular/core'
import { ComponentPaginationLight, RestExtractor, RestService, ServerService, UserService } from '@app/core'
import { objectToFormData } from '@app/helpers'
import {
  BooleanBothQuery,
  FeedFormat,
  NSFWPolicyType,
  ResultList,
  UserVideoRate,
  UserVideoRateType,
  UserVideoRateUpdate,
  Video as VideoServerModel,
  VideoChannel as VideoChannelServerModel,
  VideoConstant,
  VideoDetails as VideoDetailsServerModel,
  VideoFileMetadata,
  VideoInclude,
  VideoPrivacy,
  VideoSortField,
  VideoTranscodingCreate,
  VideoUpdate
} from '@shared/models'
import { environment } from '../../../../environments/environment'
import { Account } from '../account/account.model'
import { AccountService } from '../account/account.service'
import { VideoChannel, VideoChannelService } from '../video-channel'
import { VideoDetails } from './video-details.model'
import { VideoEdit } from './video-edit.model'
import { Video } from './video.model'

export type CommonVideoParams = {
  videoPagination?: ComponentPaginationLight
  sort: VideoSortField | SortMeta
  include?: VideoInclude
  isLocal?: boolean
  categoryOneOf?: number[]
  languageOneOf?: string[]
  privacyOneOf?: VideoPrivacy[]
  isLive?: boolean
  skipCount?: boolean

  // FIXME: remove?
  nsfwPolicy?: NSFWPolicyType
  nsfw?: BooleanBothQuery
}

@Injectable()
export class VideoService {
  static BASE_VIDEO_URL = environment.apiUrl + '/api/v1/videos'
  static BASE_FEEDS_URL = environment.apiUrl + '/feeds/videos.'
  static BASE_SUBSCRIPTION_FEEDS_URL = environment.apiUrl + '/feeds/subscriptions.'

  constructor (
    private authHttp: HttpClient,
    private restExtractor: RestExtractor,
    private restService: RestService,
    private serverService: ServerService
  ) {}

  getVideoViewUrl (uuid: string) {
    return `${VideoService.BASE_VIDEO_URL}/${uuid}/views`
  }

  getUserWatchingVideoUrl (uuid: string) {
    return `${VideoService.BASE_VIDEO_URL}/${uuid}/watching`
  }

  getVideo (options: { videoId: string }): Observable<VideoDetails> {
    return this.serverService.getServerLocale()
               .pipe(
                 switchMap(translations => {
                   return this.authHttp.get<VideoDetailsServerModel>(`${VideoService.BASE_VIDEO_URL}/${options.videoId}`)
                              .pipe(map(videoHash => ({ videoHash, translations })))
                 }),
                 map(({ videoHash, translations }) => new VideoDetails(videoHash, translations)),
                 catchError(err => this.restExtractor.handleError(err))
               )
  }

  updateVideo (video: VideoEdit) {
    const language = video.language || null
    const licence = video.licence || null
    const category = video.category || null
    const description = video.description || null
    const support = video.support || null
    const scheduleUpdate = video.scheduleUpdate || null
    const originallyPublishedAt = video.originallyPublishedAt || null

    const body: VideoUpdate = {
      name: video.name,
      category,
      licence,
      language,
      support,
      description,
      channelId: video.channelId,
      privacy: video.privacy,
      tags: video.tags,
      nsfw: video.nsfw,
      waitTranscoding: video.waitTranscoding,
      commentsEnabled: video.commentsEnabled,
      downloadEnabled: video.downloadEnabled,
      thumbnailfile: video.thumbnailfile,
      previewfile: video.previewfile,
      pluginData: video.pluginData,
      scheduleUpdate,
      originallyPublishedAt
    }

    const data = objectToFormData(body)

    return this.authHttp.put(`${VideoService.BASE_VIDEO_URL}/${video.id}`, data)
               .pipe(
                 map(this.restExtractor.extractDataBool),
                 catchError(err => this.restExtractor.handleError(err))
               )
  }

  uploadVideo (video: FormData) {
    const req = new HttpRequest('POST', `${VideoService.BASE_VIDEO_URL}/upload`, video, { reportProgress: true })

    return this.authHttp
               .request<{ video: { id: number, uuid: string } }>(req)
               .pipe(catchError(err => this.restExtractor.handleError(err)))
  }

  getMyVideos (options: {
    videoPagination: ComponentPaginationLight
    sort: VideoSortField
    userChannels?: VideoChannelServerModel[]
    search?: string
  }): Observable<ResultList<Video>> {
    const { videoPagination, sort, userChannels = [], search } = options

    const pagination = this.restService.componentToRestPagination(videoPagination)

    let params = new HttpParams()
    params = this.restService.addRestGetParams(params, pagination, sort)

    if (search) {
      const filters = this.restService.parseQueryStringFilter(search, {
        isLive: {
          prefix: 'isLive:',
          isBoolean: true
        },
        channelId: {
          prefix: 'channel:',
          handler: (name: string) => {
            const channel = userChannels.find(c => c.name === name)

            if (channel) return channel.id

            return undefined
          }
        }
      })

      params = this.restService.addObjectParams(params, filters)
    }

    return this.authHttp
               .get<ResultList<Video>>(UserService.BASE_USERS_URL + 'me/videos', { params })
               .pipe(
                 switchMap(res => this.extractVideos(res)),
                 catchError(err => this.restExtractor.handleError(err))
               )
  }

  getAccountVideos (parameters: CommonVideoParams & {
    account: Pick<Account, 'nameWithHost'>
    search?: string
  }): Observable<ResultList<Video>> {
    const { account, search } = parameters

    let params = new HttpParams()
    params = this.buildCommonVideosParams({ params, ...parameters })

    if (search) params = params.set('search', search)

    return this.authHttp
               .get<ResultList<Video>>(AccountService.BASE_ACCOUNT_URL + account.nameWithHost + '/videos', { params })
               .pipe(
                 switchMap(res => this.extractVideos(res)),
                 catchError(err => this.restExtractor.handleError(err))
               )
  }

  getVideoChannelVideos (parameters: CommonVideoParams & {
    videoChannel: Pick<VideoChannel, 'nameWithHost'>
  }): Observable<ResultList<Video>> {
    const { videoChannel } = parameters

    let params = new HttpParams()
    params = this.buildCommonVideosParams({ params, ...parameters })

    return this.authHttp
               .get<ResultList<Video>>(VideoChannelService.BASE_VIDEO_CHANNEL_URL + videoChannel.nameWithHost + '/videos', { params })
               .pipe(
                 switchMap(res => this.extractVideos(res)),
                 catchError(err => this.restExtractor.handleError(err))
               )
  }

  getVideos (parameters: CommonVideoParams): Observable<ResultList<Video>> {
    let params = new HttpParams()
    params = this.buildCommonVideosParams({ params, ...parameters })

    return this.authHttp
               .get<ResultList<Video>>(VideoService.BASE_VIDEO_URL, { params })
               .pipe(
                 switchMap(res => this.extractVideos(res)),
                 catchError(err => this.restExtractor.handleError(err))
               )
  }

  buildBaseFeedUrls (params: HttpParams, base = VideoService.BASE_FEEDS_URL) {
    const feeds = [
      {
        format: FeedFormat.RSS,
        label: 'media rss 2.0',
        url: base + FeedFormat.RSS.toLowerCase()
      },
      {
        format: FeedFormat.ATOM,
        label: 'atom 1.0',
        url: base + FeedFormat.ATOM.toLowerCase()
      },
      {
        format: FeedFormat.JSON,
        label: 'json 1.0',
        url: base + FeedFormat.JSON.toLowerCase()
      }
    ]

    if (params && params.keys().length !== 0) {
      for (const feed of feeds) {
        feed.url += '?' + params.toString()
      }
    }

    return feeds
  }

  getVideoFeedUrls (sort: VideoSortField, isLocal: boolean, categoryOneOf?: number[]) {
    let params = this.restService.addRestGetParams(new HttpParams(), undefined, sort)

    if (isLocal) params = params.set('isLocal', isLocal)

    if (categoryOneOf) {
      for (const c of categoryOneOf) {
        params = params.append('categoryOneOf[]', c + '')
      }
    }

    return this.buildBaseFeedUrls(params)
  }

  getAccountFeedUrls (accountId: number) {
    let params = this.restService.addRestGetParams(new HttpParams())
    params = params.set('accountId', accountId.toString())

    return this.buildBaseFeedUrls(params)
  }

  getVideoChannelFeedUrls (videoChannelId: number) {
    let params = this.restService.addRestGetParams(new HttpParams())
    params = params.set('videoChannelId', videoChannelId.toString())

    return this.buildBaseFeedUrls(params)
  }

  getVideoSubscriptionFeedUrls (accountId: number, feedToken: string) {
    let params = this.restService.addRestGetParams(new HttpParams())
    params = params.set('accountId', accountId.toString())
    params = params.set('token', feedToken)

    return this.buildBaseFeedUrls(params, VideoService.BASE_SUBSCRIPTION_FEEDS_URL)
  }

  getVideoFileMetadata (metadataUrl: string) {
    return this.authHttp
               .get<VideoFileMetadata>(metadataUrl)
               .pipe(
                 catchError(err => this.restExtractor.handleError(err))
               )
  }

  removeVideo (idArg: number | number[]) {
    const ids = Array.isArray(idArg) ? idArg : [ idArg ]

    return from(ids)
      .pipe(
        concatMap(id => this.authHttp.delete(`${VideoService.BASE_VIDEO_URL}/${id}`)),
        toArray(),
        catchError(err => this.restExtractor.handleError(err))
      )
  }

  removeVideoFiles (videoIds: (number | string)[], type: 'hls' | 'webtorrent') {
    return from(videoIds)
      .pipe(
        concatMap(id => this.authHttp.delete(VideoService.BASE_VIDEO_URL + '/' + id + '/' + type)),
        toArray(),
        catchError(err => this.restExtractor.handleError(err))
      )
  }

  runTranscoding (videoIds: (number | string)[], type: 'hls' | 'webtorrent') {
    const body: VideoTranscodingCreate = { transcodingType: type }

    return from(videoIds)
      .pipe(
        concatMap(id => this.authHttp.post(VideoService.BASE_VIDEO_URL + '/' + id + '/transcoding', body)),
        toArray(),
        catchError(err => this.restExtractor.handleError(err))
      )
  }

  loadCompleteDescription (descriptionPath: string) {
    return this.authHttp
               .get<{ description: string }>(environment.apiUrl + descriptionPath)
               .pipe(
                 map(res => res.description),
                 catchError(err => this.restExtractor.handleError(err))
               )
  }

  setVideoLike (id: number) {
    return this.setVideoRate(id, 'like')
  }

  setVideoDislike (id: number) {
    return this.setVideoRate(id, 'dislike')
  }

  unsetVideoLike (id: number) {
    return this.setVideoRate(id, 'none')
  }

  getUserVideoRating (id: number) {
    const url = UserService.BASE_USERS_URL + 'me/videos/' + id + '/rating'

    return this.authHttp.get<UserVideoRate>(url)
               .pipe(catchError(err => this.restExtractor.handleError(err)))
  }

  extractVideos (result: ResultList<VideoServerModel>) {
    return this.serverService.getServerLocale()
               .pipe(
                 map(translations => {
                   const videosJson = result.data
                   const totalVideos = result.total
                   const videos: Video[] = []

                   for (const videoJson of videosJson) {
                     videos.push(new Video(videoJson, translations))
                   }

                   return { total: totalVideos, data: videos }
                 })
               )
  }

  explainedPrivacyLabels (serverPrivacies: VideoConstant<VideoPrivacy>[], defaultPrivacyId = VideoPrivacy.PUBLIC) {
    const descriptions = {
      [VideoPrivacy.PRIVATE]: $localize`Only I can see this video`,
      [VideoPrivacy.UNLISTED]: $localize`Only shareable via a private link`,
      [VideoPrivacy.PUBLIC]: $localize`Anyone can see this video`,
      [VideoPrivacy.INTERNAL]: $localize`Only users of this instance can see this video`
    }

    const videoPrivacies = serverPrivacies.map(p => {
      return {
        ...p,

        description: descriptions[p.id]
      }
    })

    return {
      videoPrivacies,
      defaultPrivacyId: serverPrivacies.find(p => p.id === defaultPrivacyId)?.id || serverPrivacies[0].id
    }
  }

  getHighestAvailablePrivacy (serverPrivacies: VideoConstant<VideoPrivacy>[]) {
    const order = [ VideoPrivacy.PRIVATE, VideoPrivacy.INTERNAL, VideoPrivacy.UNLISTED, VideoPrivacy.PUBLIC ]

    for (const privacy of order) {
      if (serverPrivacies.find(p => p.id === privacy)) {
        return privacy
      }
    }

    throw new Error('No highest privacy available')
  }

  nsfwPolicyToParam (nsfwPolicy: NSFWPolicyType) {
    return nsfwPolicy === 'do_not_list'
      ? 'false'
      : 'both'
  }

  buildCommonVideosParams (options: CommonVideoParams & { params: HttpParams }) {
    const {
      params,
      videoPagination,
      sort,
      isLocal,
      include,
      categoryOneOf,
      languageOneOf,
      privacyOneOf,
      skipCount,
      nsfwPolicy,
      isLive,
      nsfw
    } = options

    const pagination = videoPagination
      ? this.restService.componentToRestPagination(videoPagination)
      : undefined

    let newParams = this.restService.addRestGetParams(params, pagination, sort)

    if (skipCount) newParams = newParams.set('skipCount', skipCount + '')

    if (isLocal) newParams = newParams.set('isLocal', isLocal)
    if (include) newParams = newParams.set('include', include)
    if (isLive) newParams = newParams.set('isLive', isLive)
    if (nsfw) newParams = newParams.set('nsfw', nsfw)
    if (nsfwPolicy) newParams = newParams.set('nsfw', this.nsfwPolicyToParam(nsfwPolicy))
    if (languageOneOf) newParams = this.restService.addArrayParams(newParams, 'languageOneOf', languageOneOf)
    if (categoryOneOf) newParams = this.restService.addArrayParams(newParams, 'categoryOneOf', categoryOneOf)
    if (privacyOneOf) newParams = this.restService.addArrayParams(newParams, 'privacyOneOf', privacyOneOf)

    return newParams
  }

  private setVideoRate (id: number, rateType: UserVideoRateType) {
    const url = `${VideoService.BASE_VIDEO_URL}/${id}/rate`
    const body: UserVideoRateUpdate = {
      rating: rateType
    }

    return this.authHttp
               .put(url, body)
               .pipe(
                 map(this.restExtractor.extractDataBool),
                 catchError(err => this.restExtractor.handleError(err))
               )
  }
}
