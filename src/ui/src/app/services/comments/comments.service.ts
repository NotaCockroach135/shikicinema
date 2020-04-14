import {Injectable} from '@angular/core';
import {BehaviorSubject, combineLatest, iif, Observable, of, ReplaySubject} from 'rxjs';
import {Shikimori} from '../../types/shikimori';
import {ShikimoriService} from '../shikimori-api/shikimori.service';
import {distinctUntilChanged, map, mergeMap, scan, shareReplay, switchMap} from 'rxjs/operators';

@Injectable({
  providedIn: 'root'
})
export class CommentsService {

  private static readonly PLAYER_URL = chrome.runtime.getURL('/');

  private totalComments = 0;
  private limit = 20;
  private page = 1;

  private _animeSubject = new ReplaySubject<Shikimori.Anime>();
  private _episodeSubject = new ReplaySubject<number>(1);
  private _limitSubject = new BehaviorSubject<number>(20);
  private _orderSubject = new BehaviorSubject<'0' | '1'>('1');
  private _pageSubject = new BehaviorSubject<number>(1);
  private _domParser = new DOMParser();

  readonly anime$ = this._animeSubject
    .pipe(
      distinctUntilChanged((a, b) => a.id === b.id)
    );

  readonly episode$ = this._episodeSubject
    .pipe(
      distinctUntilChanged()
    );

  readonly limit$ = this._limitSubject
    .pipe(
      distinctUntilChanged()
    );

  readonly order$ = this._orderSubject
    .pipe(
      distinctUntilChanged()
    );

  readonly page$ = this._pageSubject
    .pipe(
      distinctUntilChanged()
    );

  readonly topic$ = this.episode$
    .pipe(
      (episode$) => combineLatest([this.anime$, episode$]),
      switchMap(([anime, episode]) => this.shikimori.getAnimeTopics(anime.id, 'episode', episode)),
      map((topics: Shikimori.ITopic[]) => topics[0]),
      shareReplay(1)
    );

  readonly _comments$ = this.topic$
    .pipe(
      (topic$) => combineLatest([topic$, this.page$, this.limit$, this.order$]),
      mergeMap(([topic, page, limit, order]) => iif(() => !!topic,
        this.shikimori.getComments(topic.id, 'Topic', page, limit, order),
        of([])
      )),
      map((comments: Shikimori.Comment[]) => comments.map((c) => this.parseHtml(c))),
      shareReplay(1)
    );


  readonly comments$: Observable<Shikimori.Comment[]> = this._comments$
    .pipe(
      scan((acc, value) => {
        console.debug('switched to', acc[0] && value[0] && acc[0].commentableId !== value[0].commentableId ? value[0]?.commentableId : acc[0]?.commentableId)
        return acc[0] && value[0] && acc[0].commentableId === value[0].commentableId ? [...value, ...acc] : value
      }, []),
    );

  constructor(
    private shikimori: ShikimoriService
  ) {
    this.page$.subscribe((page) => this.page = page);
    this.topic$.subscribe((topic) => {
      this.totalComments = topic.comments_count;
      this._pageSubject.next(1);
    });
    this.limit$.subscribe((limit) => this.limit = limit);
  }

  public setAnime(anime: Shikimori.Anime) {
    this._animeSubject.next(anime);
  }

  public setEpisode(episode: number) {
    this._episodeSubject.next(episode);
  }

  public setLimit(limit: number) {
    this._limitSubject.next(limit > 0 && limit <= 30 ? limit : 20);
  }

  public setOrder(order: '0' | '1') {
    this._orderSubject.next(order);
  }

  public setPage(page: number) {
    this._pageSubject.next(page);
  }

  public nextPage() {
    if (this.hasNextPage) {
      this._pageSubject.next(++this.page);
    }
  }

  public get pagesRemaining(): number {
    return (this.totalComments / this.pageSize) - this.page;
  }

  public get commentsRemaining(): number {
    const commentsShowed = this.pageSize * this.page;
    return this.totalComments - commentsShowed;
  }

  public get hasNextPage(): boolean {
    return this.pagesRemaining > 0;
  }

  public get pageSize(): number {
    return this.limit;
  }

  cleanUrl(url: string) {
    return url.startsWith(CommentsService.PLAYER_URL)
      ? url.replace(CommentsService.PLAYER_URL, 'https://shikimori.one/')
      : url;
  }

  parseHtml(comment: Shikimori.Comment): Shikimori.Comment {
    let parsedComment = this._domParser.parseFromString(comment.html, 'text/html');

    parsedComment
      .querySelectorAll('.b-link')
      .forEach((elem) => elem.classList.replace('b-link', 'shc-links'));
    parsedComment
      .querySelectorAll('.b-image')
      .forEach((elem) => elem.classList.replace('b-image', 'shc-image'));
    parsedComment
      .querySelectorAll('.b-replies')
      .forEach((elem) => elem.classList.replace('b-replies', 'shc-replies'));
    parsedComment
      .querySelectorAll('.b-spoiler')
      .forEach((elem) => elem.classList.replace('b-spoiler', 'shc-spoiler'));
    parsedComment
      .querySelectorAll('.b-quote')
      .forEach((elem) => elem.classList.replace('b-quote', 'shc-quote'));

    parsedComment
      .querySelectorAll('.inner')
      .forEach((elem) => elem.classList.add('text'));
    parsedComment
      .querySelectorAll('.b-mention')
      .forEach((elem) => elem.classList.add('shc-links'));
    parsedComment
      .querySelectorAll('.shc-spoiler')
      .forEach((elem) => elem.classList.add('inline'));

    parsedComment
      .querySelectorAll('a[href]')
      .forEach((link: HTMLLinkElement) => link.href = this.cleanUrl(link.href))
    parsedComment
      .querySelectorAll('*[src]')
      .forEach((resource: HTMLSourceElement) => resource.src = this.cleanUrl(resource.src))

    comment.html = parsedComment.documentElement.innerHTML;
    return comment;
  }
}
